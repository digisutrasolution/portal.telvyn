import { describe, expect, it, vi } from "vitest";
import { HealthStatus, TelecomStatus } from "@prisma/client";
import { NodeHealthEvaluatorService } from "./node-health-evaluator.service";

const TTL = 90_000;
const now = 1_000_000_000_000;

describe("NodeHealthEvaluatorService.decideTarget (pure, caps at UNKNOWN)", () => {
  const d = NodeHealthEvaluatorService.decideTarget;

  it("administratively DISABLED → DISABLED (even with a fresh heartbeat)", () => {
    expect(d(TelecomStatus.DISABLED, new Date(now), now, TTL)).toBe(HealthStatus.DISABLED);
  });

  it("a heartbeat within the TTL → HEALTHY", () => {
    expect(d(TelecomStatus.ACTIVE, new Date(now - 10_000), now, TTL)).toBe(HealthStatus.HEALTHY);
  });

  it("a heartbeat exactly at the TTL boundary is still fresh → HEALTHY", () => {
    expect(d(TelecomStatus.ACTIVE, new Date(now - TTL), now, TTL)).toBe(HealthStatus.HEALTHY);
  });

  it("a stale heartbeat (beyond TTL) → UNKNOWN, never UNHEALTHY/DEGRADED", () => {
    expect(d(TelecomStatus.ACTIVE, new Date(now - TTL - 1), now, TTL)).toBe(HealthStatus.UNKNOWN);
  });

  it("never seen a heartbeat (null) → UNKNOWN", () => {
    expect(d(TelecomStatus.ACTIVE, null, now, TTL)).toBe(HealthStatus.UNKNOWN);
    expect(d(TelecomStatus.SUSPENDED, null, now, TTL)).toBe(HealthStatus.UNKNOWN);
  });
});

type NodeRow = { id: string; status: TelecomStatus; health: { status: HealthStatus; lastHeartbeatAt: Date | null } | null };

function makeService(opts: { nodes: NodeRow[]; set?: "OK" | null | "throw" }) {
  const nodeHealthUpdate = vi.fn().mockResolvedValue({});
  const healthEventCreate = vi.fn().mockResolvedValue({});
  const set = vi.fn(async () => {
    if (opts.set === "throw") throw new Error("redis down");
    return opts.set === undefined ? "OK" : opts.set;
  });
  const evalFn = vi.fn().mockResolvedValue(1);
  const prisma = {
    telecomNode: { findMany: vi.fn().mockResolvedValue(opts.nodes) },
    nodeHealth: { update: nodeHealthUpdate },
    healthEvent: { create: healthEventCreate },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as ConstructorParameters<typeof NodeHealthEvaluatorService>[0];
  const redis = { client: { set, eval: evalFn } } as unknown as ConstructorParameters<typeof NodeHealthEvaluatorService>[1];
  return { service: new NodeHealthEvaluatorService(prisma, redis), nodeHealthUpdate, healthEventCreate, set, evalFn };
}

const fresh = (): NodeRow => ({ id: "fresh", status: TelecomStatus.ACTIVE, health: { status: HealthStatus.UNKNOWN, lastHeartbeatAt: new Date() } });
const staleAlreadyUnknown = (): NodeRow => ({ id: "stale", status: TelecomStatus.ACTIVE, health: { status: HealthStatus.UNKNOWN, lastHeartbeatAt: new Date(Date.now() - 300_000) } });

describe("NodeHealthEvaluatorService.sweep", () => {
  it("skips (does not evaluate) when the lock is held by another instance", async () => {
    const { service, nodeHealthUpdate } = makeService({ nodes: [fresh()], set: null });
    const s = await service.sweep("c1");
    expect(s).toMatchObject({ skipped: true, reason: "locked", evaluated: 0, transitioned: 0 });
    expect(nodeHealthUpdate).not.toHaveBeenCalled();
  });

  it("skips fail-closed when Redis is unavailable (never races a double-write)", async () => {
    const { service, nodeHealthUpdate } = makeService({ nodes: [fresh()], set: "throw" });
    const s = await service.sweep("c1");
    expect(s).toMatchObject({ skipped: true, reason: "lock-unavailable" });
    expect(nodeHealthUpdate).not.toHaveBeenCalled();
  });

  it("transitions only changed nodes, writes an append-only HealthEvent, and releases the lock", async () => {
    // fresh node: UNKNOWN -> HEALTHY (a change). stale node already UNKNOWN -> UNKNOWN (no change).
    const { service, nodeHealthUpdate, healthEventCreate, evalFn } = makeService({ nodes: [fresh(), staleAlreadyUnknown()] });
    const s = await service.sweep("c1");

    expect(s).toMatchObject({ skipped: false, evaluated: 2, transitioned: 1 });
    expect(nodeHealthUpdate).toHaveBeenCalledTimes(1);
    expect(nodeHealthUpdate).toHaveBeenCalledWith({ where: { nodeId: "fresh" }, data: { status: HealthStatus.HEALTHY } });
    expect(healthEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: "fresh", fromStatus: HealthStatus.UNKNOWN, toStatus: HealthStatus.HEALTHY, tenantId: null }) }),
    );
    expect(evalFn).toHaveBeenCalled(); // lock released (compare-and-delete) in finally
  });

  it("a once-HEALTHY node gone stale transitions to UNKNOWN (caps at UNKNOWN, never UNHEALTHY)", async () => {
    const node: NodeRow = { id: "n", status: TelecomStatus.ACTIVE, health: { status: HealthStatus.HEALTHY, lastHeartbeatAt: new Date(Date.now() - 300_000) } };
    const { service, healthEventCreate } = makeService({ nodes: [node] });
    const s = await service.sweep("c1");
    expect(s.transitioned).toBe(1);
    expect(healthEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStatus: HealthStatus.HEALTHY, toStatus: HealthStatus.UNKNOWN }) }),
    );
  });
});
