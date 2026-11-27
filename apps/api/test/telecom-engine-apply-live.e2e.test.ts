import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
/**
 * Phase 12N-4b — LIVE Kamailio htable apply (OPT-IN, MUTATES the engine).
 *
 * Runs the REAL KamailioJsonRpcConnector.applyConfiguration against the disposable
 * test engine's `telvyn` htable: apply → verify → idempotent re-apply → apply an
 * empty intent (rollback) → verify empty. No mocks.
 *
 * SKIPPED unless `ENGINE_LIVE_MTLS_DIR` is set, so CI/normal runs never mutate an
 * engine. Run ONLY against the disposable VPS, after confirming the `telvyn`
 * htable exists (loadmodule htable.so + modparam) — see docs/RUNBOOK.md:
 *   ENGINE_LIVE_MTLS_DIR=/path/to/mtls \
 *   ENGINE_LIVE_ENDPOINT=https://10.9.0.1:8443 \
 *   ENGINE_LIVE_ALLOWLIST=10.9.0.1/32@8443 \
 *   corepack pnpm test:e2e test/telecom-engine-apply-live.e2e.test.ts   (guarded lane, INC-DB-001B)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TelecomCredentialType, TelecomEngineType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "test";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { NodeHttpsEngineTransport } from "../src/telecom/engines/runtime/engine-http-transport";
import { KamailioJsonRpcConnector } from "../src/telecom/engines/runtime/kamailio.connector";
import { connectionProfile } from "../src/telecom/engines/runtime/connection-profiles";
import type { EngineConfigurationIntent } from "../src/telecom/engines/engine.types";
import type { TelecomCredentialService } from "../src/telecom/secrets/telecom-credential.service";

const DIR = process.env.ENGINE_LIVE_MTLS_DIR;
const ENDPOINT = process.env.ENGINE_LIVE_ENDPOINT ?? "https://10.9.0.1:8443";
const ALLOW = process.env.ENGINE_LIVE_ALLOWLIST ?? "10.9.0.1/32@8443";

const TRUNK = "01a1e724-0000-7000-8000-00000000aaaa";
const intent = (withResources: boolean): EngineConfigurationIntent => ({
  engineType: TelecomEngineType.KAMAILIO,
  carriers: [],
  trunks: withResources ? [{ id: TRUNK, name: "live", host: "h", transport: "UDP", credentialRef: null }] : [],
  dids: withResources ? [{ id: "d1", e164: "+14155550123", carrierId: null, sipTrunkId: TRUNK }] : [],
  routes: [],
});

describe.skipIf(!DIR)("Phase 12N-4b — live Kamailio htable apply (opt-in, mutating)", () => {
  let connector: KamailioJsonRpcConnector;
  const base = { provider: TelecomEngineType.KAMAILIO, endpoint: ENDPOINT, credentialId: "live", profile: connectionProfile(TelecomEngineType.KAMAILIO) };

  beforeAll(() => {
    process.env.ENGINE_MGMT_ALLOWLIST = ALLOW;
    const secret = JSON.stringify({
      cert: readFileSync(`${DIR}/client.crt`, "utf8"),
      key: readFileSync(`${DIR}/client.key`, "utf8"),
      ca: readFileSync(`${DIR}/ca.crt`, "utf8"),
    });
    // In-memory vault stub for the live test — reveals the mTLS bundle only.
    const vault = { revealForAdapter: async () => ({ type: TelecomCredentialType.ENGINE_API, secret }) } as unknown as TelecomCredentialService;
    connector = new KamailioJsonRpcConnector(new NodeHttpsEngineTransport(), vault);
  });

  it("applies, verifies, is idempotent, then rolls back to empty", async () => {
    // Clean slate.
    const reset = await connector.applyConfiguration({ ...base, correlationId: randomUUID(), intent: intent(false) });
    expect(reset.ok).toBe(true);

    // Apply the desired set.
    const applied = await connector.applyConfiguration({ ...base, correlationId: randomUUID(), intent: intent(true) });
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.setOps).toBeGreaterThanOrEqual(2);

    // Idempotent re-apply — 0 ops.
    const again = await connector.applyConfiguration({ ...base, correlationId: randomUUID(), intent: intent(true) });
    expect(again.ok).toBe(true);
    expect(again.setOps).toBe(0);
    expect(again.delOps).toBe(0);

    // Rollback to empty — the managed keys are deleted.
    const rolledBack = await connector.applyConfiguration({ ...base, correlationId: randomUUID(), intent: intent(false) });
    expect(rolledBack.ok).toBe(true);
    expect(rolledBack.delOps).toBeGreaterThanOrEqual(2);
  });
});
