import { Injectable } from "@nestjs/common";
import { HealthStatus, TelecomCredentialType } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { EngineConnector, type EngineProbeInput, type EngineProbeResult, type EngineApplyInput, type EngineApplyResult } from "./engine-connector";
import { EngineHttpTransport } from "./engine-http-transport";
import { EngineErrorCode } from "../engine.types";
import { TelecomCredentialService } from "../../secrets/telecom-credential.service";
import { TELVYN_HTABLE, MAX_ENTRIES, buildDesiredEntries, diffEntries, parseDumpEntries, type HtableEntry } from "./htable-config";

/**
 * Real Kamailio management connector (Phase 12M-3). Probes engine health over
 * **JSONRPC** (`core.version`) through the mTLS gateway, using the injected
 * transport (the only network seam). The mTLS client credential is resolved at
 * this adapter boundary via the vault (`revealForAdapter`) and never cached,
 * logged, or returned.
 *
 * Honest health mapping (the connection manager derives REACHABLE/UNREACHABLE/
 * UNVERIFIED from `contacted`/`latencyMs`):
 *  - valid `core.version` result      → HEALTHY   (contacted, latency)
 *  - the engine answered but not OK    → UNHEALTHY (contacted, no latency)
 *    (non-2xx HTTP, JSONRPC error, or no usable version)
 *  - could not reach / verify at all   → UNKNOWN   (not contacted)
 *    (no endpoint/credential, unusable credential, connection refused, timeout,
 *     TLS failure, or an egress-policy block) — never a fabricated HEALTHY.
 *
 * Kamailio is a SIP ROUTER (originate:false): this connector performs read-only
 * health introspection. Pushing configuration is a separate, later concern
 * (there is no engine↔resource assignment model yet) and is NOT done here.
 */

interface ParsedMtls {
  cert: string;
  key: string;
  ca?: string;
}

/** Expected ENGINE_API secret shape: `{"cert":"<pem>","key":"<pem>","ca":"<pem>"?}`. */
function parseMtls(secret: string): ParsedMtls | null {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.cert !== "string" || typeof o.key !== "string") return null;
  if (!o.cert.includes("BEGIN CERTIFICATE") || !o.key.includes("BEGIN")) return null;
  const m: ParsedMtls = { cert: o.cert, key: o.key };
  if (typeof o.ca === "string" && o.ca.includes("BEGIN CERTIFICATE")) m.ca = o.ca;
  return m;
}

/** Extract a version string from a JSONRPC `core.version` response, or null. */
function extractVersion(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.error) return null; // JSONRPC error object present
  const result = o.result;
  if (typeof result === "string" && result.trim().length > 0) return result.trim().slice(0, 120);
  if (result && typeof result === "object") {
    const v = (result as Record<string, unknown>).version ?? (result as Record<string, unknown>).Version;
    if (typeof v === "string" && v.trim().length > 0) return v.trim().slice(0, 120);
  }
  return null;
}

/** Map a transport failure to a SAFE, fixed reason — never raw provider/TLS text. */
function safeReason(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = (e as { message?: string } | null)?.message ?? "";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) return "timed out";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
  if (/not routable\/public/i.test(msg)) return "blocked by egress policy";
  if (/cert|ssl|tls|self.signed/i.test(`${code} ${msg}`)) return "TLS verification failed";
  return "connection failed";
}

const unverified = (detail: string): EngineProbeResult => ({ status: HealthStatus.UNKNOWN, detail, contacted: false });

@Injectable()
export class KamailioJsonRpcConnector extends EngineConnector {
  readonly kind = "kamailio-jsonrpc";

  constructor(
    private readonly transport: EngineHttpTransport,
    private readonly vault: TelecomCredentialService,
  ) {
    super();
  }

  async probe(input: EngineProbeInput): Promise<EngineProbeResult> {
    if (!input.endpoint) return unverified("engine has no management endpoint configured");
    if (!input.credentialId) return unverified("engine has no management credential configured");

    let mtls: ParsedMtls | null;
    try {
      const cred = await this.vault.revealForAdapter(input.credentialId);
      if (cred.type !== TelecomCredentialType.ENGINE_API) {
        return unverified("configured credential is not an engine management credential");
      }
      mtls = parseMtls(cred.secret);
    } catch {
      return unverified("engine management credential is unavailable");
    }
    if (!mtls) return unverified("engine management credential is malformed");

    const rpc = { jsonrpc: "2.0", id: input.correlationId, method: "core.version", params: [] as unknown[] };
    const url = input.endpoint.endsWith("/") ? input.endpoint : `${input.endpoint}/`;
    const started = performance.now();
    let res;
    try {
      res = await this.transport.postJson({
        url,
        body: rpc,
        mtls,
        connectTimeoutMs: input.profile.connectTimeoutMs,
        requestTimeoutMs: input.profile.requestTimeoutMs,
        correlationId: input.correlationId,
      });
    } catch (e) {
      return { status: HealthStatus.UNKNOWN, detail: `engine unreachable: ${safeReason(e)}`, contacted: false };
    }

    const latencyMs = Math.round(performance.now() - started);
    if (res.httpStatus < 200 || res.httpStatus >= 300) {
      return { status: HealthStatus.UNHEALTHY, detail: `engine management returned HTTP ${res.httpStatus}`, contacted: true };
    }
    const version = extractVersion(res.json);
    if (!version) {
      return { status: HealthStatus.UNHEALTHY, detail: "engine management did not return a valid core.version result", contacted: true };
    }
    return { status: HealthStatus.HEALTHY, latencyMs, detail: `reachable — ${version}`, contacted: true };
  }

  /**
   * Apply the desired config to the dedicated `telvyn` htable via JSONRPC
   * (Phase 12N-4b, ADR-0013): dump → deterministic diff → bounded `htable.sets`/
   * `htable.delete` → re-dump VERIFY. Idempotent (a second apply is a 0-op NOOP).
   * Only the `telvyn` htable is ever named; foreign keys are never touched. No
   * success is reported unless the re-dump equals the desired set.
   */
  async applyConfiguration(input: EngineApplyInput): Promise<EngineApplyResult> {
    if (!input.endpoint) return unavailable("engine has no management endpoint configured");
    if (!input.credentialId) return unavailable("engine has no management credential configured");

    let mtls: ReturnType<typeof parseMtls>;
    try {
      const cred = await this.vault.revealForAdapter(input.credentialId);
      if (cred.type !== TelecomCredentialType.ENGINE_API) return unavailable("configured credential is not an engine management credential");
      mtls = parseMtls(cred.secret);
    } catch {
      return unavailable("engine management credential is unavailable");
    }
    if (!mtls) return unavailable("engine management credential is malformed");

    // Build + validate the desired set BEFORE any egress. A malformed set is rejected whole.
    const desired = buildDesiredEntries(input.intent);
    if ("error" in desired) {
      return { ok: false, outcome: "INVALID_CONFIG", code: EngineErrorCode.INVALID_CONFIG, detail: desired.error, applied: false };
    }

    const url = input.endpoint.endsWith("/") ? input.endpoint : `${input.endpoint}/`;
    try {
      const current = parseDumpEntries(await this.rpc(mtls, url, "htable.dump", [TELVYN_HTABLE], input));
      const diff = diffEntries(desired.entries, current);
      if (diff.sets.length + diff.deletes.length > MAX_ENTRIES) {
        return { ok: false, outcome: "INVALID_CONFIG", code: EngineErrorCode.INVALID_CONFIG, detail: "apply diff exceeds the operation bound", applied: false };
      }

      for (const e of diff.sets) await this.rpc(mtls, url, "htable.sets", [TELVYN_HTABLE, e.key, e.value], input);
      for (const k of diff.deletes) await this.rpc(mtls, url, "htable.delete", [TELVYN_HTABLE, k], input);

      // VERIFY: re-dump and confirm the managed entries exactly equal the desired set.
      const after = parseDumpEntries(await this.rpc(mtls, url, "htable.dump", [TELVYN_HTABLE], input));
      if (!matchesDesired(desired.entries, after)) {
        return { ok: false, outcome: "APPLY_INCOMPLETE", code: EngineErrorCode.INTERNAL, detail: "engine state did not match desired after apply", applied: false, setOps: diff.sets.length, delOps: diff.deletes.length };
      }
      return { ok: true, outcome: "OK", detail: `applied — ${diff.sets.length} set, ${diff.deletes.length} deleted`, applied: true, setOps: diff.sets.length, delOps: diff.deletes.length };
    } catch (e) {
      if (e instanceof RpcFailure) {
        return { ok: false, outcome: e.code === EngineErrorCode.TIMEOUT ? "TIMEOUT" : "UNAVAILABLE", code: e.code, detail: e.detail, applied: false };
      }
      return { ok: false, outcome: "UNAVAILABLE", code: EngineErrorCode.UNAVAILABLE, detail: "engine apply failed", applied: false };
    }
  }

  /** One JSONRPC call over the mTLS transport. Throws RpcFailure (typed) on any failure. */
  private async rpc(mtls: NonNullable<ReturnType<typeof parseMtls>>, url: string, method: string, params: unknown[], input: EngineApplyInput): Promise<unknown> {
    let res;
    try {
      res = await this.transport.postJson({
        url,
        body: { jsonrpc: "2.0", id: input.correlationId, method, params },
        mtls,
        connectTimeoutMs: input.profile.connectTimeoutMs,
        requestTimeoutMs: input.profile.requestTimeoutMs,
        correlationId: input.correlationId,
      });
    } catch (e) {
      const reason = safeReason(e);
      throw new RpcFailure(reason === "timed out" ? EngineErrorCode.TIMEOUT : EngineErrorCode.UNAVAILABLE, `engine ${method} unreachable: ${reason}`);
    }
    if (res.httpStatus < 200 || res.httpStatus >= 300) throw new RpcFailure(EngineErrorCode.UNAVAILABLE, `engine ${method} returned HTTP ${res.httpStatus}`);
    const json = res.json as Record<string, unknown> | undefined;
    if (json && json.error) throw new RpcFailure(EngineErrorCode.UNAVAILABLE, `engine ${method} returned an error`);
    return json?.result;
  }
}

/** Typed RPC failure used internally by the apply flow. */
class RpcFailure {
  constructor(
    readonly code: EngineErrorCode,
    readonly detail: string,
  ) {}
}

const unavailable = (detail: string): EngineApplyResult => ({ ok: false, outcome: "UNAVAILABLE", code: EngineErrorCode.UNAVAILABLE, detail, applied: false });

/** Managed entries after apply must EXACTLY equal the desired set (no extra, no missing). */
function matchesDesired(desired: HtableEntry[], after: Map<string, string>): boolean {
  if (after.size !== desired.length) return false;
  for (const e of desired) {
    if (after.get(e.key) !== e.value) return false;
  }
  return true;
}
