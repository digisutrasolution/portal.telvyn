import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigChangeType, type TelecomEngineType, type TelecomStatus } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { EngineService } from "../engine.service";
import { EngineErrorCode } from "../engine.types";
import { EngineLockService } from "./engine-lock.service";
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

export interface SyncOutcome {
  ok: boolean;
  outcome: string;
  code?: EngineErrorCode;
  desiredVersion: string;
  appliedVersion: string | null;
  changed: boolean;
  correlationId: string;
  detail?: string;
}

type EngineRef = { id: string; type: TelecomEngineType; endpoint: string | null; status: TelecomStatus };

interface VersionSnapshot {
  kind: "desired" | "applied";
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
  ) {}

  /** Build the (currently empty) desired intent. Engine↔resource assignment is a future model. */
  private desiredIntent(engine: EngineRef) {
    return this.engineService.buildConfigurationIntent({ engineType: engine.type, carriers: [], trunks: [], dids: [], routes: [] });
  }

  private ttlMs(engine: EngineRef): number {
    return connectionProfile(engine.type).maxOperationMs;
  }

  async sync(engine: EngineRef, actorId: string | null, correlationId: string): Promise<SyncOutcome> {
    return this.lock.withLock(engine.id, this.ttlMs(engine), async () => {
      const intent = this.desiredIntent(engine);
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
        return { ok: true, outcome: "NOOP", desiredVersion: shortFingerprint(desiredFp), appliedVersion: appliedFp && shortFingerprint(appliedFp), changed: false, correlationId, detail: "engine already in desired state" };
      }

      const result = await this.engineService.sync(engine, intent, undefined);
      if (result.ok) {
        // Future: a real adapter that applies successfully records an applied version here.
        await this.record(engine.id, ConfigChangeType.STATUS_CHANGE, appliedFp, { kind: "applied", fingerprint: desiredFp, short: shortFingerprint(desiredFp), summary }, actorId, correlationId);
      }
      this.log(engine, correlationId, result.outcome, desiredFp, result.code);
      return {
        ok: result.ok,
        outcome: result.outcome,
        code: result.code,
        desiredVersion: shortFingerprint(desiredFp),
        appliedVersion: result.ok ? shortFingerprint(desiredFp) : appliedFp ? shortFingerprint(appliedFp) : null,
        changed: decision.changed,
        correlationId,
        detail: result.detail,
      };
    });
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
      const intent = this.desiredIntent(engine);
      const result = await this.engineService.sync(engine, intent, undefined);
      this.log(engine, correlationId, `rollback:${result.outcome}`, decision.targetFp, result.code);
      return {
        ok: result.ok,
        outcome: `ROLLBACK_${result.outcome}`,
        code: result.code,
        desiredVersion: shortFingerprint(decision.targetFp),
        appliedVersion: appliedFp ? shortFingerprint(appliedFp) : null,
        changed: true,
        correlationId,
        detail: result.detail,
      };
    });
  }

  /** Current version posture for status display (no mutation). */
  async posture(engineId: string): Promise<{ desiredVersion: string | null; appliedVersion: string | null; versions: number }> {
    const history = await this.loadHistory(engineId);
    const desired = history.find((h) => h.kind === "desired")?.fingerprint ?? null;
    const applied = history.find((h) => h.kind === "applied")?.fingerprint ?? null;
    return {
      desiredVersion: desired ? shortFingerprint(desired) : null,
      appliedVersion: applied ? shortFingerprint(applied) : null,
      versions: history.filter((h) => h.kind === "desired").length,
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
      if (c && (c.kind === "desired" || c.kind === "applied") && typeof c.fingerprint === "string") out.push(c);
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
