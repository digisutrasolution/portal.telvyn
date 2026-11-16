import { Injectable } from "@nestjs/common";
import { HealthStatus, TelecomCredentialType } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { EngineConnector, type EngineProbeInput, type EngineProbeResult } from "./engine-connector";
import { EngineHttpTransport } from "./engine-http-transport";
import { TelecomCredentialService } from "../../secrets/telecom-credential.service";

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
}
