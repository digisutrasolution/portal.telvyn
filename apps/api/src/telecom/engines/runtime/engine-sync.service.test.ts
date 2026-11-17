import { describe, expect, it } from "vitest";
import { TelecomEngineType, TelecomStatus } from "@prisma/client";
import { EngineSyncService, decideSync, decideRollback, decideApplyOutcome } from "./engine-sync.service";
import { EngineLockBusy, type EngineLockService } from "./engine-lock.service";
import { EngineService } from "../engine.service";
import type { EngineAssignmentsService } from "../engine-assignments.service";
import { EngineErrorCode } from "../engine.types";

describe("decideSync (pure idempotency)", () => {
  it("NOOP only when applied === desired", () => {
    expect(decideSync({ desiredFp: "a", appliedFp: "a" })).toEqual({ action: "NOOP", changed: false });
    expect(decideSync({ desiredFp: "a", appliedFp: "b" })).toEqual({ action: "APPLY", changed: true });
    expect(decideSync({ desiredFp: "a", appliedFp: null })).toEqual({ action: "APPLY", changed: true });
  });
});

describe("decideRollback (pure stale/target selection)", () => {
  it("errors without a distinct previous version", () => {
    expect(decideRollback([])).toHaveProperty("error");
    expect(decideRollback([{ fingerprint: "a" }])).toHaveProperty("error");
    expect(decideRollback([{ fingerprint: "a" }, { fingerprint: "a" }])).toHaveProperty("error");
  });
  it("targets the most recent distinct previous version", () => {
    expect(decideRollback([{ fingerprint: "new" }, { fingerprint: "old" }])).toEqual({ targetFp: "old" });
  });
});

// ---- service with injected fakes (no DB/Redis) ----
function makeService(over: { syncResult?: () => Promise<unknown>; lockBusy?: boolean; history?: unknown[] } = {}) {
  const created: unknown[] = [];
  const prisma = {
    telecomConfigVersion: {
      findMany: async () => over.history ?? [],
      create: async ({ data }: { data: unknown }) => {
        created.push(data);
        return data;
      },
    },
  } as unknown as ConstructorParameters<typeof EngineSyncService>[0];

  const real = new EngineService({ getAdapter: () => ({}) } as never);
  const engineService = {
    buildConfigurationIntent: real.buildConfigurationIntent.bind(real),
    sync: over.syncResult ?? (async () => ({ ok: false, outcome: "NOT_IMPLEMENTED", code: EngineErrorCode.NOT_IMPLEMENTED, correlationId: "x", durationMs: 1 })),
  } as unknown as EngineService;

  const lock = {
    withLock: async (_id: string, _ttl: number, fn: () => Promise<unknown>) => {
      if (over.lockBusy) throw new EngineLockBusy();
      return fn();
    },
  } as unknown as EngineLockService;

  const assignments = {
    buildConfigurationSource: async (_engineId: string, engineType: TelecomEngineType) => ({ engineType, carriers: [], trunks: [], dids: [], routes: [] }),
  } as unknown as EngineAssignmentsService;

  return { svc: new EngineSyncService(prisma, engineService, lock, assignments), created };
}
const engine = { id: "00000000-0000-7000-8000-000000000001", type: TelecomEngineType.KAMAILIO, endpoint: null, status: TelecomStatus.ACTIVE };

describe("EngineSyncService.sync (honest, versioned)", () => {
  it("records a desired version and returns honest NOT_IMPLEMENTED (applied never advances)", async () => {
    const { svc, created } = makeService();
    const r = await svc.sync(engine, "actor-1", "cid-1");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("NOT_IMPLEMENTED");
    expect(r.code).toBe(EngineErrorCode.NOT_IMPLEMENTED);
    expect(r.desiredVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(r.appliedVersion).toBeNull(); // honest — nothing applied
    expect(created.length).toBe(1); // one desired ConfigVersion appended
  });

  it("propagates a busy lock (concurrency guard)", async () => {
    const { svc } = makeService({ lockBusy: true });
    await expect(svc.sync(engine, "actor-1", "cid-2")).rejects.toBeInstanceOf(EngineLockBusy);
  });

  it("surfaces a TIMEOUT from the adapter layer unchanged", async () => {
    const { svc } = makeService({
      syncResult: async () => ({ ok: false, outcome: "ERROR", code: EngineErrorCode.TIMEOUT, correlationId: "x", durationMs: 1 }),
    });
    const r = await svc.sync(engine, null, "cid-3");
    expect(r.code).toBe(EngineErrorCode.TIMEOUT);
    expect(r.ok).toBe(false);
  });

  it("NOT_IMPLEMENTED → FAILED, no outcome snapshot recorded", async () => {
    const { svc, created } = makeService();
    const r = await svc.sync(engine, "a", "cid-f");
    expect(r.syncState).toBe("FAILED");
    expect(created.length).toBe(1); // only the desired version — no applied/reconcile snapshot
  });

  it("success → APPLIED, applied version advances + an applied snapshot is recorded", async () => {
    const { svc, created } = makeService({ syncResult: async () => ({ ok: true, outcome: "OK", correlationId: "x", durationMs: 1 }) });
    const r = await svc.sync(engine, "a", "cid-ok");
    expect(r.syncState).toBe("APPLIED");
    expect(r.appliedVersion).toBe(r.desiredVersion); // advanced
    expect((created as { newConfig: { kind: string } }[]).some((c) => c.newConfig.kind === "applied")).toBe(true);
  });

  it("TIMEOUT → PENDING_RECONCILIATION, applied NOT advanced + a reconcile_pending snapshot is recorded", async () => {
    const { svc, created } = makeService({ syncResult: async () => ({ ok: false, outcome: "ERROR", code: EngineErrorCode.TIMEOUT, correlationId: "x", durationMs: 1 }) });
    const r = await svc.sync(engine, "a", "cid-to");
    expect(r.syncState).toBe("PENDING_RECONCILIATION");
    expect(r.appliedVersion).toBeNull(); // engine state unknown — never claimed applied
    expect((created as { newConfig: { kind: string } }[]).some((c) => c.newConfig.kind === "reconcile_pending")).toBe(true);
  });
});

describe("decideApplyOutcome (pure applied-version state machine)", () => {
  it("success advances applied; timeout reconciles; other failures do not record", () => {
    expect(decideApplyOutcome({ ok: true })).toMatchObject({ syncState: "APPLIED", record: true, advanceApplied: true });
    expect(decideApplyOutcome({ ok: false, code: EngineErrorCode.TIMEOUT })).toMatchObject({ syncState: "PENDING_RECONCILIATION", record: true, advanceApplied: false });
    expect(decideApplyOutcome({ ok: false, code: EngineErrorCode.NOT_IMPLEMENTED })).toMatchObject({ syncState: "FAILED", record: false, advanceApplied: false });
    expect(decideApplyOutcome({ ok: false, code: EngineErrorCode.UNAVAILABLE })).toMatchObject({ syncState: "FAILED", record: false });
  });
});

describe("EngineSyncService.posture (lifecycle state)", () => {
  it("reports PENDING_RECONCILIATION after a timeout, with applied unchanged", async () => {
    const { svc } = makeService({
      history: [
        { newConfig: { kind: "reconcile_pending", fingerprint: "desiredX" } },
        { newConfig: { kind: "applied", fingerprint: "appliedA" } },
        { newConfig: { kind: "desired", fingerprint: "desiredX" } },
      ],
    });
    const p = await svc.posture("00000000-0000-7000-8000-000000000001");
    expect(p.syncState).toBe("PENDING_RECONCILIATION");
    expect(p.appliedVersion).toBe((await import("./engine-config")).shortFingerprint("appliedA"));
  });
});

describe("EngineSyncService.rollback", () => {
  it("throws when there is no previous version", async () => {
    const { svc } = makeService({ history: [{ newConfig: { kind: "desired", fingerprint: "only" } }] });
    await expect(svc.rollback(engine, "actor-1", "cid-4")).rejects.toThrow(/previous/i);
  });
});
