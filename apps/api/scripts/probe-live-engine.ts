/**
 * Phase 12M-4 — live engine integration proof.
 *
 * Stores the mTLS bundle as an ENGINE_API vault credential, points a KAMAILIO
 * engine at the private management gateway, and runs the REAL
 * `KamailioJsonRpcConnector` against it — the honest end-to-end integration
 * (no mocks): vault decrypt → NodeHttpsEngineTransport (mTLS, rebinding recheck)
 * → nginx gateway → Kamailio JSONRPC `core.version`.
 *
 * Usage (from apps/api):
 *   node -r @swc-node/register scripts/probe-live-engine.ts <mtls-dir> [endpoint]
 * where <mtls-dir> holds client.crt / client.key / ca.crt.
 */
import "dotenv/config";
import { PrismaClient, TelecomCredentialType, TelecomEngineType, TelecomStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { encryptSecret } from "@/common/crypto.util";
import { loadEnv } from "@/config/env";
import { TelecomCredentialService } from "@/telecom/secrets/telecom-credential.service";
import type { PrismaService } from "@/infra/prisma.service";
import { NodeHttpsEngineTransport } from "@/telecom/engines/runtime/engine-http-transport";
import { KamailioJsonRpcConnector } from "@/telecom/engines/runtime/kamailio.connector";
import { connectionProfile } from "@/telecom/engines/runtime/connection-profiles";

const MTLS_DIR = process.argv[2];
const ENDPOINT = process.argv[3] ?? "https://10.9.0.1:8443";
if (!MTLS_DIR) {
  console.error("usage: probe-live-engine.ts <mtls-dir> [endpoint]");
  process.exit(2);
}

async function main(): Promise<void> {
  // The private gateway is reached over WireGuard — authorize that exact endpoint.
  process.env.ENGINE_MGMT_ALLOWLIST = process.env.ENGINE_MGMT_ALLOWLIST ?? "10.9.0.1/32@8443";
  const env = loadEnv();
  const prisma = new PrismaClient();

  const bundle = JSON.stringify({
    cert: readFileSync(`${MTLS_DIR}/client.crt`, "utf8"),
    key: readFileSync(`${MTLS_DIR}/client.key`, "utf8"),
    ca: readFileSync(`${MTLS_DIR}/ca.crt`, "utf8"),
  });

  // Upsert the platform-scoped ENGINE_API vault credential (secret encrypted at rest).
  const label = "kamailio-vps-mtls";
  const secretEnc = encryptSecret(bundle, env.APP_ENCRYPTION_KEY);
  const existingCred = await prisma.telecomCredential.findFirst({ where: { label, type: TelecomCredentialType.ENGINE_API, deletedAt: null } });
  const cred = existingCred
    ? await prisma.telecomCredential.update({ where: { id: existingCred.id }, data: { secretEnc } })
    : await prisma.telecomCredential.create({ data: { tenantId: null, type: TelecomCredentialType.ENGINE_API, label, hint: "mTLS client cert", secretEnc } });

  // Upsert the KAMAILIO engine pointing at the private gateway.
  const name = "kamailio-vps-9345109a";
  const existingEngine = await prisma.telecomEngine.findFirst({ where: { name, deletedAt: null } });
  const engine = existingEngine
    ? await prisma.telecomEngine.update({ where: { id: existingEngine.id }, data: { endpoint: ENDPOINT, credentialId: cred.id, status: TelecomStatus.ACTIVE } })
    : await prisma.telecomEngine.create({ data: { name, type: TelecomEngineType.KAMAILIO, provider: "kamailio", endpoint: ENDPOINT, credentialId: cred.id, status: TelecomStatus.ACTIVE } });

  console.log(`engine=${engine.id} credential=${cred.id} endpoint=${engine.endpoint}`);

  // Run the REAL connector (vault reveal → mTLS transport → gateway → Kamailio).
  const vault = new TelecomCredentialService(prisma as unknown as PrismaService);
  const connector = new KamailioJsonRpcConnector(new NodeHttpsEngineTransport(), vault);
  const result = await connector.probe({
    provider: TelecomEngineType.KAMAILIO,
    endpoint: engine.endpoint,
    credentialId: engine.credentialId,
    profile: connectionProfile(TelecomEngineType.KAMAILIO),
    correlationId: randomUUID(),
  });

  console.log("ENGINE PROBE RESULT:", JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(result.status === "HEALTHY" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
