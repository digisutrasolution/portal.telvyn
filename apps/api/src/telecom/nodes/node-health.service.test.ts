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
