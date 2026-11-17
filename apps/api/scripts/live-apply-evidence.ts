/**
 * Phase 12N-4b — live apply evidence capture (operator-authorized, mutating).
 * Interleaves the REAL KamailioJsonRpcConnector.applyConfiguration with raw
 * htable.dump reads so each stage (before / applied / idempotent / rollback) is
 * visible. Mutates ONLY the `telvyn` htable. Usage:
 *   node -r @swc-node/register scripts/live-apply-evidence.ts <mtls-dir> [endpoint]
 */
import { TelecomCredentialType, TelecomEngineType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NodeHttpsEngineTransport } from "@/telecom/engines/runtime/engine-http-transport";
import { KamailioJsonRpcConnector } from "@/telecom/engines/runtime/kamailio.connector";
import { connectionProfile } from "@/telecom/engines/runtime/connection-profiles";
import type { TelecomCredentialService } from "@/telecom/secrets/telecom-credential.service";
import type { EngineConfigurationIntent } from "@/telecom/engines/engine.types";

const DIR = process.argv[2];
const ENDPOINT = process.argv[3] ?? "https://10.9.0.1:8443";
if (!DIR) { console.error("usage: live-apply-evidence.ts <mtls-dir> [endpoint]"); process.exit(2); }
process.env.ENGINE_MGMT_ALLOWLIST = process.env.ENGINE_MGMT_ALLOWLIST ?? "10.9.0.1/32@8443";

const mtls = {
  cert: readFileSync(`${DIR}/client.crt`, "utf8"),
  key: readFileSync(`${DIR}/client.key`, "utf8"),
  ca: readFileSync(`${DIR}/ca.crt`, "utf8"),
};
const transport = new NodeHttpsEngineTransport();
const profile = connectionProfile(TelecomEngineType.KAMAILIO);
const vault = { revealForAdapter: async () => ({ type: TelecomCredentialType.ENGINE_API, secret: JSON.stringify(mtls) }) } as unknown as TelecomCredentialService;
const connector = new KamailioJsonRpcConnector(transport, vault);
const url = ENDPOINT.endsWith("/") ? ENDPOINT : `${ENDPOINT}/`;

const TRUNK = "01a1e724-0000-7000-8000-00000000aaaa";
const intent = (withResources: boolean): EngineConfigurationIntent => ({
  engineType: TelecomEngineType.KAMAILIO,
  carriers: [],
  trunks: withResources ? [{ id: TRUNK, name: "live", host: "h", transport: "UDP", credentialRef: null }] : [],
  dids: withResources ? [{ id: "d1", e164: "+14155550123", carrierId: null, sipTrunkId: TRUNK }] : [],
  routes: [],
});

async function dump(label: string): Promise<void> {
  const res = await transport.postJson({ url, body: { jsonrpc: "2.0", id: randomUUID(), method: "htable.dump", params: ["telvyn"] }, mtls, connectTimeoutMs: profile.connectTimeoutMs, requestTimeoutMs: profile.requestTimeoutMs, correlationId: "evi" });
  const items = JSON.stringify((res.json as { result?: unknown })?.result ?? null);
  console.log(`DUMP  [${label}] ${items}`);
}
async function apply(label: string, withResources: boolean): Promise<void> {
  const r = await connector.applyConfiguration({ provider: TelecomEngineType.KAMAILIO, endpoint: ENDPOINT, credentialId: "live", profile, correlationId: randomUUID(), intent: intent(withResources) });
  console.log(`APPLY [${label}] ok=${r.ok} applied=${r.applied} outcome=${r.outcome} setOps=${r.setOps ?? "-"} delOps=${r.delOps ?? "-"} detail="${r.detail}"`);
}

async function main(): Promise<void> {
  await dump("0 before");
  await apply("1 reset-to-empty", false);
  await dump("1 after reset");
  await apply("2 apply desired", true);
  await dump("2 after apply");
  await apply("3 idempotent re-apply", true);
  await dump("3 after re-apply");
  await apply("4 rollback-to-empty", false);
  await dump("4 after rollback");
}
main().catch((e) => { console.error(e); process.exit(1); });
