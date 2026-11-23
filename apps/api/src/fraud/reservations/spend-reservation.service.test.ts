import { describe, it, expect, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type SpendReservation } from "@prisma/client";
import { SpendReservationService, secondsUntilEndOfUtcDay, secondsUntilEndOfUtcMonth } from "./spend-reservation.service";
import type { PrismaService } from "@/infra/prisma.service";
import type { RedisService } from "@/infra/redis.service";
import type { TenantContext } from "@/authz/tenant-context";

const ctx = { tenantId: "t1" } as TenantContext;

function row(over: Partial<SpendReservation> = {}): SpendReservation {
  return {
    id: "r1",
    tenantId: "t1",
    idempotencyKey: "k1",
    amountMicros: 5000n,
    settledMicros: null,
    currency: "USD",
    status: "ACTIVE",
    correlationId: null,
    expiresAt: new Date("2026-11-23T12:05:00.000Z"),
    settledAt: null,
    releasedAt: null,
    createdAt: new Date("2026-11-23T12:00:00.000Z"),
    updatedAt: new Date("2026-11-23T12:00:00.000Z"),
    ...over,
  };
}

interface Fakes {
  scopedFindFirst?: ReturnType<typeof vi.fn>;
  scopedCreate?: ReturnType<typeof vi.fn>;
  baseUpdate?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
  mget?: ReturnType<typeof vi.fn>;
  evalFn?: ReturnType<typeof vi.fn>;
}
function makeService(f: Fakes = {}) {
  const prisma = {
    scoped: { spendReservation: { findFirst: f.scopedFindFirst ?? vi.fn(), create: f.scopedCreate ?? vi.fn() } },
    spendReservation: { update: f.baseUpdate ?? vi.fn(), findMany: f.findMany ?? vi.fn(), updateMany: f.updateMany ?? vi.fn() },
  } as unknown as PrismaService;
  const redis = { client: { mget: f.mget ?? vi.fn(), eval: f.evalFn ?? vi.fn() } } as unknown as RedisService;
  return new SpendReservationService(prisma, redis);
}

describe("SpendReservationService.readReserved", () => {
  it("returns reserved micros per period, defaulting missing keys to 0", async () => {
    const svc = makeService({ mget: vi.fn().mockResolvedValue(["5000", null]) });
    expect(await svc.readReserved("t1")).toEqual({ DAILY: 5000, MONTHLY: 0 });
  });
  it("fails closed (ServiceUnavailable) when Redis is unreachable", async () => {
    const svc = makeService({ mget: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(svc.readReserved("t1")).rejects.toThrow(ServiceUnavailableException);
  });
  it("never returns a negative reserved total", async () => {
    const svc = makeService({ mget: vi.fn().mockResolvedValue(["-100", "0"]) });
    expect(await svc.readReserved("t1")).toEqual({ DAILY: 0, MONTHLY: 0 });
  });
});

describe("SpendReservationService.reserve", () => {
  it("creates a durable hold and raises both window gauges", async () => {
    const create = vi.fn().mockResolvedValue(row());
    const evalFn = vi.fn().mockResolvedValue(5000);
    const svc = makeService({ scopedFindFirst: vi.fn().mockResolvedValue(null), scopedCreate: create, evalFn });
    const v = await svc.reserve(ctx, { idempotencyKey: "k1", amountMicros: 5000, ttlSeconds: 300 });
    expect(v.amountMicros).toBe(5000);
    expect(v.status).toBe("ACTIVE");
    expect(create).toHaveBeenCalledOnce();
    expect(evalFn).toHaveBeenCalledTimes(2); // DAILY + MONTHLY
  });

  it("is idempotent — an existing hold for the key is returned without a second create or gauge bump", async () => {
    const create = vi.fn();
    const evalFn = vi.fn();
    const svc = makeService({ scopedFindFirst: vi.fn().mockResolvedValue(row({ amountMicros: 7000n })), scopedCreate: create, evalFn });
    const v = await svc.reserve(ctx, { idempotencyKey: "k1", amountMicros: 5000, ttlSeconds: 300 });
    expect(v.amountMicros).toBe(7000);
    expect(create).not.toHaveBeenCalled();
    expect(evalFn).not.toHaveBeenCalled();
  });

  it("fails closed — undoes the hold (RELEASED) and throws when the gauge cannot be raised", async () => {
    const update = vi.fn().mockResolvedValue(row({ status: "RELEASED" }));
    const svc = makeService({
      scopedFindFirst: vi.fn().mockResolvedValue(null),
      scopedCreate: vi.fn().mockResolvedValue(row()),
      baseUpdate: update,
      evalFn: vi.fn().mockRejectedValue(new Error("down")),
    });
    await expect(svc.reserve(ctx, { idempotencyKey: "k1", amountMicros: 5000, ttlSeconds: 300 })).rejects.toThrow(ServiceUnavailableException);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RELEASED" }) }));
  });

  it("returns the winner's hold when it loses a unique-key race (P2002)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" });
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row({ amountMicros: 9000n }));
    const svc = makeService({ scopedFindFirst: findFirst, scopedCreate: vi.fn().mockRejectedValue(err), evalFn: vi.fn() });
    const v = await svc.reserve(ctx, { idempotencyKey: "k1", amountMicros: 5000, ttlSeconds: 300 });
    expect(v.amountMicros).toBe(9000);
  });
});

describe("SpendReservationService.settle / release", () => {
  it("settle records the actual cost and lowers the gauge", async () => {
    const update = vi.fn().mockResolvedValue(row({ status: "SETTLED" }));
    const evalFn = vi.fn().mockResolvedValue(0);
    const svc = makeService({ scopedFindFirst: vi.fn().mockResolvedValue(row()), baseUpdate: update, evalFn });
    await svc.settle(ctx, "k1", 4200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED", settledMicros: 4200n }) }));
    expect(evalFn).toHaveBeenCalledTimes(2);
  });

  it("settle is a no-op on a hold that is not ACTIVE", async () => {
    const update = vi.fn();
    const evalFn = vi.fn();
    const svc = makeService({ scopedFindFirst: vi.fn().mockResolvedValue(row({ status: "SETTLED" })), baseUpdate: update, evalFn });
    await svc.settle(ctx, "k1", 100);
    expect(update).not.toHaveBeenCalled();
    expect(evalFn).not.toHaveBeenCalled();
  });

  it("release returns an ACTIVE hold and lowers the gauge", async () => {
    const update = vi.fn().mockResolvedValue(row({ status: "RELEASED" }));
    const evalFn = vi.fn().mockResolvedValue(0);
    const svc = makeService({ scopedFindFirst: vi.fn().mockResolvedValue(row()), baseUpdate: update, evalFn });
    await svc.release(ctx, "k1");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RELEASED" }) }));
    expect(evalFn).toHaveBeenCalledTimes(2);
  });

  it("release is a no-op when the hold is absent", async () => {
    const update = vi.fn();
    const svc = makeService({ scopedFindFirst: vi.fn().mockResolvedValue(null), baseUpdate: update });
    await svc.release(ctx, "missing");
    expect(update).not.toHaveBeenCalled();
  });

  it("a gauge error on settle/release is swallowed (self-heals later)", async () => {
    const svc = makeService({
      scopedFindFirst: vi.fn().mockResolvedValue(row()),
      baseUpdate: vi.fn().mockResolvedValue(row()),
      evalFn: vi.fn().mockRejectedValue(new Error("down")),
    });
    await expect(svc.release(ctx, "k1")).resolves.toBeUndefined();
  });
});

describe("SpendReservationService.expireDue", () => {
  it("expires overdue ACTIVE holds across tenants and returns each one's gauge hold", async () => {
    const findMany = vi.fn().mockResolvedValue([row({ id: "a", tenantId: "t1", amountMicros: 1000n }), row({ id: "b", tenantId: "t2", amountMicros: 2000n })]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const evalFn = vi.fn().mockResolvedValue(0);
    const svc = makeService({ findMany, updateMany, evalFn });
    expect(await svc.expireDue(new Date())).toBe(2);
    expect(evalFn).toHaveBeenCalledTimes(4); // 2 rows × 2 periods
  });

  it("does not count (or refund) a hold a concurrent settle already claimed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const evalFn = vi.fn();
    const svc = makeService({ findMany: vi.fn().mockResolvedValue([row()]), updateMany, evalFn });
    expect(await svc.expireDue(new Date())).toBe(0);
    expect(evalFn).not.toHaveBeenCalled();
  });
});

describe("window-remaining helpers (UTC)", () => {
  it("counts whole seconds to the next UTC midnight", () => {
    expect(secondsUntilEndOfUtcDay(new Date("2026-11-23T23:00:00.000Z"))).toBe(3600);
  });
  it("counts whole seconds to the first instant of the next UTC month", () => {
    expect(secondsUntilEndOfUtcMonth(new Date("2026-11-30T23:00:00.000Z"))).toBe(3600);
  });
  it("never returns less than one second", () => {
    expect(secondsUntilEndOfUtcDay(new Date("2026-11-23T23:59:59.900Z"))).toBeGreaterThanOrEqual(1);
  });
});
