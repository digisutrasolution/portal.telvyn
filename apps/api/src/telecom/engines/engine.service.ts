import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { HealthStatus, type TelecomEngineType } from "@prisma/client";
import { EngineRegistryService } from "./engine-registry.service";
import {
  EngineError,
  EngineErrorCode,
  type EngineConfigurationIntent,
  type EngineContext,
  type EngineOperationResult,
  type EngineStatus,
} from "./engine.types";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30_000;

/** Raw control-plane resources fed to the intent builder (id refs + non-secret config only). */
export interface EngineConfigurationSource {
  engineType: TelecomEngineType;
  carriers: { id: string; name: string; priority: number; credentialId: string | null }[];
  trunks: { id: string; name: string; host: string | null; transport: string; credentialId: string | null }[];
  dids: { id: string; e164: string; carrierId: string | null; sipTrunkId: string | null }[];
  routes: { id: string; destinationType: string; priority: number }[];
}

/**
 * Control-plane engine orchestration (Phase 12K). Resolves adapters via the
 * registry and performs provider-neutral operations with bounded timeouts,
 * correlation IDs, structured logging, and normalized errors. NOTHING here
 * contacts an engine or executes SIP/RTP — adapters are honest stubs, so status
 * health is UNKNOWN and mutating ops return a normalized NOT_IMPLEMENTED result.
 */
@Injectable()
export class EngineService {
  private readonly logger = new Logger("EngineService");

  constructor(private readonly registry: EngineRegistryService) {}

  private newContext(engineId?: string, timeoutMs = DEFAULT_TIMEOUT_MS): EngineContext {
    return { correlationId: randomUUID(), timeoutMs: Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS), engineId };
  }

  /** Bounded timeout guard — never infinite. Rejects with a normalized TIMEOUT. */
  private async withTimeout<T>(op: Promise<T>, ctx: EngineContext): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EngineError(EngineErrorCode.TIMEOUT, "engine operation timed out", ctx.correlationId)), ctx.timeoutMs);
    });
    try {
      return await Promise.race([op, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Structured, secret-free observability line for an engine operation. */
  private logOp(fields: { provider: TelecomEngineType; engineId?: string; operation: string; correlationId: string; durationMs: number; outcome: string; code?: EngineErrorCode }): void {
    this.logger.log(JSON.stringify(fields));
  }

  /** Compose a normalized engine status: explicit capabilities + honest health. */
  async getStatus(engine: { id: string; type: TelecomEngineType }, timeoutMs?: number): Promise<EngineStatus> {
    const ctx = this.newContext(engine.id, timeoutMs);
    const adapter = this.registry.getAdapter(engine.type);
    const start = Date.now();
    let health;
    try {
      health = await this.withTimeout(adapter.healthCheck(), ctx);
    } catch (e) {
      // Health probe failure is itself health information — never throw, report honestly.
      const detail = e instanceof EngineError ? `probe ${e.code.toLowerCase()}` : "probe failed";
      health = { status: HealthStatus.UNKNOWN, detail };
    }
    const durationMs = Date.now() - start;
    this.logOp({ provider: engine.type, engineId: engine.id, operation: "status", correlationId: ctx.correlationId, durationMs, outcome: health.status });
    return {
      engineId: engine.id,
      provider: engine.type,
      implemented: adapter.implemented,
      capabilities: adapter.capabilities(),
      health,
      correlationId: ctx.correlationId,
      checkedAt: new Date(),
    };
  }

  /**
   * Attempt to synchronize configuration to the engine. With stub adapters this
   * returns a normalized NOT_IMPLEMENTED result — honest, no fake success, no
   * engine connectivity.
   */
  async sync(engine: { id: string; type: TelecomEngineType }, intent: EngineConfigurationIntent, timeoutMs?: number): Promise<EngineOperationResult> {
    const ctx = this.newContext(engine.id, timeoutMs);
    const adapter = this.registry.getAdapter(engine.type);
    const start = Date.now();
    try {
      const result = await this.withTimeout(adapter.applyConfiguration(intent, ctx), ctx);
      this.logOp({ provider: engine.type, engineId: engine.id, operation: "sync", correlationId: ctx.correlationId, durationMs: Date.now() - start, outcome: result.outcome, code: result.code });
      return result;
    } catch (e) {
      const durationMs = Date.now() - start;
      const norm = this.normalizeError(e, ctx.correlationId, durationMs);
      this.logOp({ provider: engine.type, engineId: engine.id, operation: "sync", correlationId: ctx.correlationId, durationMs, outcome: norm.outcome, code: norm.code });
      return norm;
    }
  }

  /** Normalize any thrown error into a platform result — engine internals never leak. */
  normalizeError(e: unknown, correlationId: string, durationMs: number): EngineOperationResult {
    if (e instanceof EngineError) {
      return {
        ok: false,
        outcome: e.code === EngineErrorCode.NOT_IMPLEMENTED ? "NOT_IMPLEMENTED" : "ERROR",
        code: e.code,
        correlationId,
        durationMs,
        detail: e.message,
      };
    }
    // Unknown/engine-specific error — normalized, detail suppressed (no leakage).
    return { ok: false, outcome: "ERROR", code: EngineErrorCode.INTERNAL, correlationId, durationMs, detail: "engine operation failed" };
  }

  /**
   * PURE translator: control-plane resources → a provider-neutral configuration
   * intent. Carries only id references + non-secret config — credentials are
   * reduced to a `credentialRef` (the id), NEVER a secret. No I/O, no execution.
   */
  buildConfigurationIntent(src: EngineConfigurationSource): EngineConfigurationIntent {
    return {
      engineType: src.engineType,
      carriers: src.carriers.map((c) => ({ id: c.id, name: c.name, priority: c.priority, credentialRef: c.credentialId })),
      trunks: src.trunks.map((t) => ({ id: t.id, name: t.name, host: t.host, transport: t.transport, credentialRef: t.credentialId })),
      dids: src.dids.map((d) => ({ id: d.id, e164: d.e164, carrierId: d.carrierId, sipTrunkId: d.sipTrunkId })),
      routes: src.routes.map((r) => ({ id: r.id, destinationType: r.destinationType, priority: r.priority })),
    };
  }
}
