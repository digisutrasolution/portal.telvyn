import { describe, it, expect, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { SpendLimitsService } from "./spend-limits.service";
import type { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { CreateSpendLimitInput, UpdateSpendLimitInput } from "./spend-limits.dto";

const CTX = { userId: "u", tenantId: "22222222-2222-7222-8222-222222222222" } as unknown as TenantContext;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-7111-8111-111111111111",
    tenantId: "SHOULD_NEVER_LEAK",
    period: "DAILY",
    amountMicros: 5_000_000n,
    currency: "USD",
    enabled: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

function makeService() {
  const scoped = { spendLimit: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() } };
  const raw = { updateMany: vi.fn(), update: vi.fn() };
  const prisma = { scoped, spendLimit: raw } as unknown as PrismaService;
  return { svc: new SpendLimitsService(prisma), scoped, raw };
}

describe("SpendLimitsService.view (money + safe view)", () => {
  it("serializes BigInt amountMicros to a JSON-safe number and hides tenantId/deletedAt", async () => {
    const { svc, scoped } = makeService();
    scoped.spendLimit.findFirst.mockResolvedValue(row({ amountMicros: 1_000_000_000_000n }));
    const v = await svc.get(CTX, "x");
    expect(v.amountMicros).toBe(1_000_000_000_000);
    expect(typeof v.amountMicros).toBe("number");
    expect(v).not.toHaveProperty("tenantId");
    expect(v).not.toHaveProperty("deletedAt");
  });
});

describe("SpendLimitsService.create", () => {
  it("rejects a duplicate active period with 409", async () => {
    const { svc, scoped } = makeService();
    scoped.spendLimit.findFirst.mockResolvedValue({ id: "existing" });
    await expect(svc.create(CTX, { period: "DAILY", amountMicros: 1 } as CreateSpendLimitInput)).rejects.toThrow(
      ConflictException,
    );
    expect(scoped.spendLimit.create).not.toHaveBeenCalled();
  });

  it("creates when none exists, stamping server-derived tenantId and BigInt amount", async () => {
    const { svc, scoped } = makeService();
    scoped.spendLimit.findFirst.mockResolvedValue(null);
    scoped.spendLimit.create.mockResolvedValue(row());
    await svc.create(CTX, { period: "DAILY", amountMicros: 5_000_000 } as CreateSpendLimitInput);
    const data = scoped.spendLimit.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(CTX.tenantId);
    expect(data.amountMicros).toBe(5_000_000n);
    expect(data.currency).toBe("USD");
  });
});

describe("SpendLimitsService.update", () => {
  it("throws 409 on a version mismatch (optimistic concurrency)", async () => {
    const { svc, scoped, raw } = makeService();
    scoped.spendLimit.findFirst.mockResolvedValue(row()); // load ok
    raw.updateMany.mockResolvedValue({ count: 0 }); // stale expectedVersion → no row updated
    await expect(
      svc.update(CTX, "x", { amountMicros: 9, expectedVersion: 1 } as UpdateSpendLimitInput),
    ).rejects.toThrow(ConflictException);
  });

  it("404s updating a foreign/unknown limit (scoped load miss)", async () => {
    const { svc, scoped } = makeService();
    scoped.spendLimit.findFirst.mockResolvedValue(null);
    await expect(svc.update(CTX, "x", { amountMicros: 9 } as UpdateSpendLimitInput)).rejects.toThrow(NotFoundException);
  });
});
