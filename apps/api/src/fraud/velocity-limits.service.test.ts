import { describe, it, expect, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { VelocityLimitsService } from "./velocity-limits.service";
import type { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { CreateVelocityLimitInput, UpdateVelocityLimitInput } from "./velocity-limits.dto";

const CTX = { userId: "u", tenantId: "22222222-2222-7222-8222-222222222222" } as unknown as TenantContext;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-7111-8111-111111111111",
    tenantId: "SHOULD_NEVER_LEAK",
    metric: "CALLS_PER_MINUTE",
    limit: 60,
    enabled: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

function makeService() {
  const scoped = { velocityLimit: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() } };
  const raw = { updateMany: vi.fn(), update: vi.fn() };
  const prisma = { scoped, velocityLimit: raw } as unknown as PrismaService;
  return { svc: new VelocityLimitsService(prisma), scoped, raw };
}

describe("VelocityLimitsService.view (safe view)", () => {
  it("returns the integer limit and hides tenantId/deletedAt", async () => {
    const { svc, scoped } = makeService();
    scoped.velocityLimit.findFirst.mockResolvedValue(row({ limit: 120 }));
    const v = await svc.get(CTX, "x");
    expect(v.limit).toBe(120);
    expect(v).not.toHaveProperty("tenantId");
    expect(v).not.toHaveProperty("deletedAt");
  });
});

describe("VelocityLimitsService.create", () => {
  it("rejects a duplicate active metric with 409", async () => {
    const { svc, scoped } = makeService();
    scoped.velocityLimit.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      svc.create(CTX, { metric: "CALLS_PER_MINUTE", limit: 60 } as CreateVelocityLimitInput),
    ).rejects.toThrow(ConflictException);
    expect(scoped.velocityLimit.create).not.toHaveBeenCalled();
  });

  it("creates when none exists, stamping server-derived tenantId", async () => {
    const { svc, scoped } = makeService();
    scoped.velocityLimit.findFirst.mockResolvedValue(null);
    scoped.velocityLimit.create.mockResolvedValue(row());
    await svc.create(CTX, { metric: "CONCURRENT_CALLS", limit: 10 } as CreateVelocityLimitInput);
    const data = scoped.velocityLimit.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(CTX.tenantId);
    expect(data.metric).toBe("CONCURRENT_CALLS");
    expect(data.limit).toBe(10);
  });
});

describe("VelocityLimitsService.update", () => {
  it("throws 409 on a version mismatch (optimistic concurrency)", async () => {
    const { svc, scoped, raw } = makeService();
    scoped.velocityLimit.findFirst.mockResolvedValue(row());
    raw.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.update(CTX, "x", { limit: 90, expectedVersion: 1 } as UpdateVelocityLimitInput),
    ).rejects.toThrow(ConflictException);
  });

  it("404s updating a foreign/unknown limit (scoped load miss)", async () => {
    const { svc, scoped } = makeService();
    scoped.velocityLimit.findFirst.mockResolvedValue(null);
    await expect(svc.update(CTX, "x", { limit: 90 } as UpdateVelocityLimitInput)).rejects.toThrow(NotFoundException);
  });
});
