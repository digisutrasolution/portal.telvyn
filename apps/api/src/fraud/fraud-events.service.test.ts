import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { FraudEventsService, normalizeMetadata } from "./fraud-events.service";
import type { PrismaService } from "@/infra/prisma.service";
import type { AuditService } from "@/authz/audit.service";
import { runWithTenantContext, type TenantContext } from "@/authz/tenant-context";
import type { RequestContext } from "@/common/request-context";

const CTX = {
  userId: "11111111-1111-7111-8111-111111111111",
  tenantId: "22222222-2222-7222-8222-222222222222",
} as unknown as TenantContext;

function makeService() {
  const create = vi.fn().mockResolvedValue(undefined);
  const findMany = vi.fn();
  const log = vi.fn().mockResolvedValue(undefined);
  const prisma = { scoped: { fraudEvent: { create, findMany } } } as unknown as PrismaService;
  const audit = { log } as unknown as AuditService;
  return { svc: new FraudEventsService(prisma, audit), create, findMany, log };
}

describe("normalizeMetadata", () => {
  it("accepts a bounded plain object", () => {
    expect(normalizeMetadata({ rule: "cpm", limit: 60 })).toEqual({ rule: "cpm", limit: 60 });
  });
  it("treats null/undefined as absent", () => {
    expect(normalizeMetadata(undefined)).toBeUndefined();
    expect(normalizeMetadata(null)).toBeUndefined();
  });
  it("rejects arrays and primitives", () => {
    expect(() => normalizeMetadata([1, 2])).toThrow(BadRequestException);
    expect(() => normalizeMetadata("nope")).toThrow(BadRequestException);
    expect(() => normalizeMetadata(42)).toThrow(BadRequestException);
  });
  it("rejects too many keys", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 60; i++) many[`k${i}`] = i;
    expect(() => normalizeMetadata(many)).toThrow(BadRequestException);
  });
  it("rejects oversized metadata", () => {
    expect(() => normalizeMetadata({ blob: "x".repeat(5000) })).toThrow(BadRequestException);
  });
});

describe("FraudEventsService.record", () => {
  it("writes the event only (no audit) for a system-raised event", async () => {
    const { svc, create, log } = makeService();
    await runWithTenantContext(CTX, () => svc.record({ type: "LIMIT_WARNING", source: "velocity", code: "CPM_WARN" }));
    expect(create).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled(); // no AuditLog firehose for system events
    expect(create.mock.calls[0][0].data).toMatchObject({
      tenantId: CTX.tenantId,
      type: "LIMIT_WARNING",
      severity: "WARNING",
      source: "velocity",
      code: "CPM_WARN",
      actorId: null,
    });
  });

  it("also writes one audit entry for an actor-driven event, stamping actorId", async () => {
    const { svc, create, log } = makeService();
    const req = { ipAddress: "1.1.1.1", userAgent: "ua" } as unknown as RequestContext;
    await svc.record({ type: "POLICY_CHANGE", source: "admin", code: "POLICY_UPDATED" }, { ctx: CTX, req });
    expect(create).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.actorId).toBe(CTX.userId);
    expect(log.mock.calls[0][0]).toMatchObject({ action: "fraud.event.recorded", resource: "fraud_event" });
  });

  it("rejects invalid metadata before any write", async () => {
    const { svc, create } = makeService();
    await expect(
      runWithTenantContext(CTX, () => svc.record({ type: "ANOMALY", source: "x", code: "Y", metadata: [1, 2] })),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("FraudEventsService.list", () => {
  it("maps rows to a safe view (never echoes tenantId) and derives nextCursor", async () => {
    const { svc, findMany } = makeService();
    const row = (id: string) => ({
      id,
      tenantId: "SHOULD_NEVER_LEAK",
      type: "ANOMALY",
      severity: "INFO",
      source: "s",
      code: "c",
      reason: null,
      correlationId: null,
      actorId: null,
      metadata: null,
      createdAt: new Date(),
    });
    findMany.mockResolvedValue([row("b"), row("a")]); // limit+1 fetched → hasMore
    const page = await svc.list({ limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("tenantId");
    expect(page.nextCursor).toBe("b");
  });
});
