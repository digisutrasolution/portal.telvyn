import { describe, expect, it, vi } from "vitest";
import { HealthEntityType, HealthStatus, TelecomStatus } from "@prisma/client";
import { NodeHealthService } from "./node-health.service";

/** A prisma stub capturing the snapshot update + health-event create, with a configurable node + last event. */
function makeService(opts: {
  node: { id: string; status: TelecomStatus; hostRef: string | null } | null;
  lastEventToStatus?: HealthStatus | null;
}) {
  const nodeHealthUpdate = vi.fn().mockResolvedValue({});
  const healthEventCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    telecomNode: { findFirst: vi.fn().mockResolvedValue(opts.node) },
    nodeHealth: { update: nodeHealthUpdate },
    healthEvent: {
      findFirst: vi.fn().mockResolvedValue(opts.lastEventToStatus === undefined ? null : opts.lastEventToStatus === null ? null : { toStatus: opts.lastEventToStatus }),
      create: healthEventCreate,
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as ConstructorParameters<typeof NodeHealthService>[0];
  return { service: new NodeHealthService(prisma), nodeHealthUpdate, healthEventCreate };
}

describe("NodeHealthService.probe", () => {
  it("resolves an UNVERIFIED posture (configured, active) to honest UNKNOWN and records the first transition", async () => {
    const { service, nodeHealthUpdate, healthEventCreate } = makeService({
      node: { id: "n1", status: TelecomStatus.ACTIVE, hostRef: "sip.example:5060" },
      lastEventToStatus: null, // no prior event
    });
    const report = await service.probe("n1", "corr-1");

    expect(report).toEqual({
      nodeId: "n1",
      status: HealthStatus.UNKNOWN,
      reachability: "UNVERIFIED",
      detail: expect.stringContaining("unverified"),
      correlationId: "corr-1",
      checkedAt: expect.any(Date),
    });
    expect(nodeHealthUpdate).toHaveBeenCalledWith({ where: { nodeId: "n1" }, data: { status: HealthStatus.UNKNOWN, latencyMs: null } });
    // First observation → a transition event is written (fromStatus null).
    expect(healthEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityType: HealthEntityType.NODE, entityId: "n1", fromStatus: null, toStatus: HealthStatus.UNKNOWN, tenantId: null }) }),
    );
  });

  it("maps an administratively DISABLED node to DISABLED (never fabricated)", async () => {
    const { service } = makeService({ node: { id: "n1", status: TelecomStatus.DISABLED, hostRef: "sip.example:5060" }, lastEventToStatus: null });
    const report = await service.probe("n1", "corr-1");
    expect(report.reachability).toBe("DISABLED");
    expect(report.status).toBe(HealthStatus.DISABLED);
  });

  it("reports UNCONFIGURED when there is no hostRef", async () => {
    const { service } = makeService({ node: { id: "n1", status: TelecomStatus.ACTIVE, hostRef: null }, lastEventToStatus: null });
    const report = await service.probe("n1", "corr-1");
    expect(report.reachability).toBe("UNCONFIGURED");
    expect(report.status).toBe(HealthStatus.UNKNOWN);
  });

  it("does NOT write a new event when the status is unchanged", async () => {
    const { service, healthEventCreate } = makeService({
      node: { id: "n1", status: TelecomStatus.ACTIVE, hostRef: "sip.example:5060" },
      lastEventToStatus: HealthStatus.UNKNOWN, // already UNKNOWN
    });
    await service.probe("n1", "corr-1");
    expect(healthEventCreate).not.toHaveBeenCalled();
  });

  it("404s for an unknown node", async () => {
    const { service } = makeService({ node: null });
    await expect(service.probe("missing", "corr-1")).rejects.toThrow(/not found/i);
  });
});

/** A raw NODE HealthEvent row as Prisma returns it (includes fields the view must NOT echo). */
function eventRow(id: string, fromStatus: HealthStatus | null, toStatus: HealthStatus) {
  return { id, entityType: HealthEntityType.NODE, entityId: "n1", tenantId: null, fromStatus, toStatus, reason: "posture", correlationId: "c1", createdAt: new Date("2026-01-01T00:00:00.000Z") };
}

function makeHistoryService(rows: ReturnType<typeof eventRow>[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = { healthEvent: { findMany } } as unknown as ConstructorParameters<typeof NodeHealthService>[0];
  return { service: new NodeHealthService(prisma), findMany };
}

describe("NodeHealthService.history", () => {
  it("scopes to the node's NODE events (newest-first cursor args) and returns a safe view", async () => {
    const { service, findMany } = makeHistoryService([eventRow("1", null, HealthStatus.UNKNOWN)]);
    const page = await service.history("n1", { limit: 25 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: HealthEntityType.NODE, entityId: "n1" }, take: 26, orderBy: { id: "desc" } }),
    );
    expect(page.items[0]).toEqual({ id: "1", fromStatus: null, toStatus: HealthStatus.UNKNOWN, reason: "posture", correlationId: "c1", createdAt: new Date("2026-01-01T00:00:00.000Z") });
    expect(page.items[0]).not.toHaveProperty("entityType");
    expect(page.items[0]).not.toHaveProperty("tenantId");
    expect(page.nextCursor).toBeNull();
  });

  it("emits a nextCursor on a full (limit+1) page and passes the cursor through", async () => {
    const { service } = makeHistoryService([eventRow("a", null, HealthStatus.UNKNOWN), eventRow("b", HealthStatus.UNKNOWN, HealthStatus.DISABLED)]);
    const page = await service.history("n1", { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("a");

    const { service: s2, findMany } = makeHistoryService([]);
    await s2.history("n1", { limit: 25, cursor: "cur-5" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: "cur-5" }, skip: 1 }));
  });
});
