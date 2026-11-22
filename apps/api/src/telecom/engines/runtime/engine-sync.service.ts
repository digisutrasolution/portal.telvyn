import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigChangeType, type TelecomEngineType, type TelecomStatus } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { cursorArgs, toPage } from "@/common/pagination";
import { EngineService } from "../engine.service";
import { EngineErrorCode } from "../engine.types";
import { EngineLockService } from "./engine-lock.service";
import { EngineAssignmentsService } from "../engine-assignments.service";
import { EngineConnectionManager } from "./engine-connection.manager";
import { connectionProfile } from "./connection-profiles";
import { fingerprintIntent, shortFingerprint } from "./engine-config";

/** Pure sync decision — deterministic + unit-testable, no I/O. */
export type SyncAction = "APPLY" | "NOOP";
export function decideSync(p: { desiredFp: string; appliedFp: string | null }): { action: SyncAction; changed: boolean } {
  if (p.appliedFp !== null && p.appliedFp === p.desiredFp) return { action: "NOOP", changed: false };
  return { action: "APPLY", changed: p.appliedFp !== p.desiredFp };
}

/** Pure rollback target selection over desired-version history (newest first). */
export function decideRollback(desiredHistory: { fingerprint: string }[]): { targetFp: string } | { error: string } {
  if (desiredHistory.length < 2) return { error: "no previous configuration version to roll back to" };
  const current = desiredHistory[0].fingerprint;
  const previous = desiredHistory.find((h) => h.fingerprint !== current);
  if (!previous) return { error: "no distinct previous configuration version to roll back to" };
  return { targetFp: previous.fingerprint };
}

/** Lifecycle of an apply attempt. NOOP = nothing to do (desired already applied). */
export type SyncState = "NOOP" | "APPLIED" | "PENDING_RECONCILIATION" | "FAILED";

/**
 * Pure applied-version state machine (Phase 12N-4a, ADR-0011 snapshot route).
 * Honest by construction:
 *  - success           → APPLIED, advance the applied version, record it.
 *  - **TIMEOUT**        → PENDING_RECONCILIATION — the engine state is UNKNOWN, so
 *                         applied is NEVER advanced, but we persist the uncertainty.
 *  - any other failure  → FAILED — transient/retryable; no snapshot, applied unchanged.
 */
export function decideApplyOutcome(result: { ok: boolean; code?: EngineErrorCode }): {
  syncState: Exclude<SyncState, "NOOP">;
  kind?: "applied" | "reconcile_pending";
  record: boolean;
  advanceApplied: boolean;
} {
  if (result.ok) return { syncState: "APPLIED", kind: "applied", record: true, advanceApplied: true };
  if (result.code === EngineErrorCode.TIMEOUT) return { syncState: "PENDING_RECONCILIATION", kind: "reconcile_pending", record: true, advanceApplied: false };
  return { syncState: "FAILED", record: false, advanceApplied: false };
}

export interface SyncOutcome {
  ok: boolean;
  outcome: string;
  code?: EngineErrorCode;
  /** Applied-version lifecycle of this attempt (Phase 12N-4a). */
  syncState: SyncState;
  desiredVersion: string;
  appliedVersion: string | null;
  changed: boolean;
  correlationId: string;
  detail?: string;
}

type EngineRef = { id: string; type: TelecomEngineType; endpoint: string | null; credentialId?: string | null; status: TelecomStatus };

interface VersionSnapshot {
  kind: "desired" | "applied" | "reconcile_pending";
  fingerprint: string;
  short: string;
  summary: Record<string, number>;
}

/**
 * Versioned, idempotent, concurrency-guarded engine configuration sync (Phase
 * 12L). Deterministic desired-version fingerprint; append-only version history
 * in TelecomConfigVersion (no migration); Redis mutex prevents double-apply;
 * rollback re-proposes a prior version (never deletes). The actual apply is
 * delegated to the adapter via EngineService — with the honest stubs it returns
 * NOT_IMPLEMENTED, so the applied version NEVER advances. No fake success.
 */
@Injectable()
export class EngineSyncService {
  private readonly logger = new Logger("EngineSyncService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly engineService: EngineService,
    private readonly lock: EngineLockService,
    private readonly assignments: EngineAssignmentsService,
    private readonly connection: EngineConnectionManager,
  ) {}

  /** Build the desired intent from the engine's enabled resource assignments (Phase 12N-3). */
  private async desiredIntent(engine: EngineRef) {
    const src = await this.assignments.buildConfigurationSource(engine.id, engine.type);
    return this.engineService.buildConfigurationIntent(src);
  }

  /** Read-only preview of the current desired config (no mutation) — for status display. */
  async previewDesired(engine: EngineRef): Promise<{ version: string; summary: Record<string, number> }> {
    const intent = await this.desiredIntent(engine);
    const fp = fingerprintIntent(intent);
    return {
      version: shortFingerprint(fp),
      summary: { carriers: intent.carriers.length, trunks: intent.trunks.length, dids: intent.dids.length, routes: intent.routes.length },
    };
  }

  private ttlMs(engine: EngineRef): number {
    return connectionProfile(engine.type).maxOperationMs;
  }

  async sync(engine: EngineRef, actorId: string | null, correlationId: string): Promise<SyncOutcome> {
    return this.lock.withLock(engine.id, this.ttlMs(engine), async () => {
      const intent = await this.desiredIntent(engine);
      const desiredFp = fingerprintIntent(intent);
      const summary = {
        carriers: intent.carriers.length,
        trunks: intent.trunks.length,
        dids: intent.dids.length,
        routes: intent.routes.length,
      };
      const history = await this.loadHistory(engine.id);
      const lastDesired = history.find((h) => h.kind === "desired") ?? null;
      const appliedFp = history.find((h) => h.kind === "applied")?.fingerprint ?? null;
      const decision = decideSync({ desiredFp, appliedFp });

      // Append a new desired version only when the desired fingerprint actually changed.
      if (!lastDesired || lastDesired.fingerprint !== desiredFp) {
        await this.record(engine.id, ConfigChangeType[lastDesired ? "UPDATE" : "CREATE"], lastDesired?.fingerprint ?? null, {
          kind: "desired",
          fingerprint: desiredFp,
          short: shortFingerprint(desiredFp),
          summary,
        }, actorId, correlationId);
      }

      if (decision.action === "NOOP") {
        this.log(engine, correlationId, "NOOP", desiredFp);
        return { ok: true, outcome: "NOOP", syncState: "NOOP", desiredVersion: shortFingerprint(desiredFp), appliedVersion: appliedFp && shortFingerprint(appliedFp), changed: false, correlationId, detail: "engine already in desired state" };
      }

      const result = await this.connection.applyConfiguration({ provider: engine.type, endpoint: engine.endpoint, credentialId: engine.credentialId, status: engine.status, correlationId, intent });
      const applied = await this.recordApplyOutcome(engine.id, desiredFp, appliedFp, summary, result, actorId, correlationId);
      this.log(engine, correlationId, `${result.outcome}:${applied.syncState}`, desiredFp, result.code);
      return {
        ok: result.ok,
        outcome: result.outcome,
        code: result.code,
        syncState: applied.syncState,
        desiredVersion: shortFingerprint(desiredFp),
        appliedVersion: applied.appliedVersion,
        changed: decision.changed,
        correlationId,
        detail: result.detail,
      };
    });
  }

  /**
   * Record the applied-version outcome honestly (Phase 12N-4a): success → an
   * `applied` snapshot (advances applied); TIMEOUT → a `reconcile_pending`
   * snapshot (applied NOT advanced — engine state unknown); other failure → no
   * snapshot. Returns the lifecycle state + the applied version to surface.
   */
  private async recordApplyOutcome(
    engineId: string,
    desiredFp: string,
    priorAppliedFp: string | null,
    summary: Record<string, number>,
    result: { ok: boolean; code?: EngineErrorCode },
    actorId: string | null,
    correlationId: string,
  ): Promise<{ syncState: SyncState; appliedVersion: string | null }> {
    const d = decideApplyOutcome(result);
    if (d.record && d.kind) {
      await this.record(engineId, ConfigChangeType.STATUS_CHANGE, priorAppliedFp, { kind: d.kind, fingerprint: desiredFp, short: shortFingerprint(desiredFp), summary }, actorId, correlationId);
    }
    const appliedVersion = d.advanceApplied ? shortFingerprint(desiredFp) : priorAppliedFp ? shortFingerprint(priorAppliedFp) : null;
    return { syncState: d.syncState, appliedVersion };
  }

  async rollback(engine: EngineRef, actorId: string | null, correlationId: string): Promise<SyncOutcome> {
    return this.lock.withLock(engine.id, this.ttlMs(engine), async () => {
      const history = await this.loadHistory(engine.id);
      const desiredHistory = history.filter((h) => h.kind === "desired");
      const decision = decideRollback(desiredHistory);
      if ("error" in decision) throw new BadRequestException(decision.error);

      const appliedFp = history.find((h) => h.kind === "applied")?.fingerprint ?? null;
      const current = desiredHistory[0];
      // Append the rollback target as the NEW desired version (append-only; never deletes history).
      await this.record(engine.id, ConfigChangeType.UPDATE, current.fingerprint, {
        kind: "desired",
        fingerprint: decision.targetFp,
        short: shortFingerprint(decision.targetFp),
        summary: {},
      }, actorId, correlationId);

      // Attempt to apply the rolled-back version — honest NOT_IMPLEMENTED/UNAVAILABLE with stubs.
      const intent = await this.desiredIntent(engine);
      const result = await this.connection.applyConfiguration({ provider: engine.type, endpoint: engine.endpoint, credentialId: engine.credentialId, status: engine.status, correlationId, intent });
      const applied = await this.recordApplyOutcome(engine.id, decision.targetFp, appliedFp, {}, result, actorId, correlationId);
      this.log(engine, correlationId, `rollback:${result.outcome}:${applied.syncState}`, decision.targetFp, result.code);
      return {
        ok: result.ok,
        outcome: `ROLLBACK_${result.outcome}`,
        code: result.code,
        syncState: applied.syncState,
        desiredVersion: shortFingerprint(decision.targetFp),
        appliedVersion: applied.appliedVersion,
        changed: true,
        correlationId,
        detail: result.detail,
      };
    });
  }

  /** Current version posture for status display (no mutation). */
  async posture(engineId: string): Promise<{ desiredVersion: string | null; appliedVersion: string | null; syncState: SyncState | null; versions: number }> {
    const history = await this.loadHistory(engineId); // newest-first
    const desired = history.find((h) => h.kind === "desired")?.fingerprint ?? null;
    const applied = history.find((h) => h.kind === "applied")?.fingerprint ?? null;
    // The most recent apply OUTCOME decides the lifecycle state. A reconcile_pending
    // after an applied means the last attempt timed out — applied stays put.
    const latestOutcome = history.find((h) => h.kind === "applied" || h.kind === "reconcile_pending");
    const syncState: SyncState | null = latestOutcome ? (latestOutcome.kind === "applied" ? "APPLIED" : "PENDING_RECONCILIATION") : null;
    return {
      desiredVersion: desired ? shortFingerprint(desired) : null,
      appliedVersion: applied ? shortFingerprint(applied) : null,
      syncState,
      versions: history.filter((h) => h.kind === "desired").length,
    };
  }

  /**
   * The engine's append-only config-version history, newest first, cursor-paginated.
   * A safe view over TelecomConfigVersion (entityType=engine): change type, the
   * version snapshot's kind + short fingerprint + resource-count summary, the prior
   * version's short fingerprint, actor + correlation — all already secret-free (the
   * snapshots never hold credentials). Reuses the uuidv7-id cursor helper.
   */
  async history(engineId: string, page: { limit: number; cursor?: string }) {
    const rows = await this.prisma.telecomConfigVersion.findMany({
      where: { entityType: "engine", entityId: engineId },
      ...cursorArgs(page.limit, page.cursor),
    });
    const { items, nextCursor } = toPage(rows, page.limit);
    return {
      items: items.map((r) => {
        const snap = (r.newConfig ?? null) as Partial<VersionSnapshot> | null;
        const prev = (r.previousConfig ?? null) as { fingerprint?: unknown } | null;
        return {
          id: r.id,
          changeType: r.changeType,
          kind: snap && typeof snap.kind === "string" ? snap.kind : null,
          version: snap && typeof snap.short === "string" ? snap.short : null,
          previousVersion: prev && typeof prev.fingerprint === "string" ? shortFingerprint(prev.fingerprint) : null,
          summary: snap && snap.summary && typeof snap.summary === "object" ? (snap.summary as Record<string, number>) : null,
          actorId: r.actorId,
          correlationId: r.correlationId,
          createdAt: r.createdAt,
        };
      }),
      nextCursor,
    };
  }

  private async loadHistory(engineId: string): Promise<VersionSnapshot[]> {
    const rows = await this.prisma.telecomConfigVersion.findMany({
      where: { entityType: "engine", entityId: engineId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { newConfig: true },
    });
    const out: VersionSnapshot[] = [];
    for (const r of rows) {
      const c = r.newConfig as unknown as VersionSnapshot | null;
      if (c && (c.kind === "desired" || c.kind === "applied" || c.kind === "reconcile_pending") && typeof c.fingerprint === "string") out.push(c);
    }
    return out;
  }

  private async record(
    engineId: string,
    changeType: ConfigChangeType,
    previousFp: string | null,
    snapshot: VersionSnapshot,
    actorId: string | null,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.telecomConfigVersion.create({
      data: {
        tenantId: null, // platform engine
        entityType: "engine",
        entityId: engineId,
        changeType,
        previousConfig: previousFp ? { fingerprint: previousFp } : undefined,
        newConfig: snapshot as unknown as object,
        actorId: actorId ?? undefined,
        correlationId,
      },
    });
  }

  private log(engine: EngineRef, correlationId: string, outcome: string, fp: string, code?: EngineErrorCode): void {
    this.logger.log(JSON.stringify({ engineId: engine.id, provider: engine.type, operation: "sync", correlationId, outcome, desiredVersion: shortFingerprint(fp), code }));
  }
}
