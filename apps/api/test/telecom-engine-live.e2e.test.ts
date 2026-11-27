import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12M-4 — live Kamailio engine integration (OPT-IN).
 *
 * Runs the REAL KamailioJsonRpcConnector against a real engine over mTLS — no
 * mocks: vault decrypt → NodeHttpsEngineTransport (mTLS + rebinding recheck) →
 * private gateway → Kamailio JSONRPC `core.version`.
 *
 * Skipped unless `ENGINE_LIVE_MTLS_DIR` is set (a dir holding client.crt/
 * client.key/ca.crt), so CI and normal local runs — which have no live engine —
 * are unaffected and the baseline stays green. To run it:
 *   ENGINE_LIVE_MTLS_DIR=/path/to/mtls \
 *   ENGINE_LIVE_ENDPOINT=https://10.9.0.1:8443 \
 *   ENGINE_LIVE_ALLOWLIST=10.9.0.1/32@8443 \
 *   corepack pnpm test:e2e test/telecom-engine-live.e2e.test.ts   (guarded lane, INC-DB-001B)
 */
import { describe, it, expect } from "vitest";
import { TelecomCredentialType, TelecomEngineType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "test";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { encryptSecret } from "../src/common/crypto.util";
import { loadEnv } from "../src/config/env";
import { TelecomCredentialService } from "../src/telecom/secrets/telecom-credential.service";
import type { PrismaService } from "../src/infra/prisma.service";
import { NodeHttpsEngineTransport } from "../src/telecom/engines/runtime/engine-http-transport";
import { KamailioJsonRpcConnector } from "../src/telecom/engines/runtime/kamailio.connector";
import { connectionProfile } from "../src/telecom/engines/runtime/connection-profiles";

const DIR = process.env.ENGINE_LIVE_MTLS_DIR;
const ENDPOINT = process.env.ENGINE_LIVE_ENDPOINT ?? "https://10.9.0.1:8443";
const ALLOW = process.env.ENGINE_LIVE_ALLOWLIST ?? "10.9.0.1/32@8443";

describe.skipIf(!DIR)("Phase 12M-4 — live Kamailio engine (opt-in)", () => {
  it("probes the real engine over mTLS and reports HEALTHY with the live version", async () => {
    process.env.ENGINE_MGMT_ALLOWLIST = ALLOW;
    const env = loadEnv();
    const prisma = fixturePrisma;
    try {
      const bundle = JSON.stringify({
        cert: readFileSync(`${DIR}/client.crt`, "utf8"),
        key: readFileSync(`${DIR}/client.key`, "utf8"),
        ca: readFileSync(`${DIR}/ca.crt`, "utf8"),
      });
      const cred = await prisma.telecomCredential.create({
        data: { tenantId: null, type: TelecomCredentialType.ENGINE_API, label: `live-${randomUUID()}`, secretEnc: encryptSecret(bundle, env.APP_ENCRYPTION_KEY) },
      });
      try {
        const vault = new TelecomCredentialService(prisma as unknown as PrismaService);
        const connector = new KamailioJsonRpcConnector(new NodeHttpsEngineTransport(), vault);
        const res = await connector.probe({
          provider: TelecomEngineType.KAMAILIO,
          endpoint: ENDPOINT,
          credentialId: cred.id,
          profile: connectionProfile(TelecomEngineType.KAMAILIO),
          correlationId: randomUUID(),
        });
        expect(res.contacted).toBe(true);
        expect(res.status).toBe("HEALTHY");
        expect(res.detail.toLowerCase()).toContain("kamailio");
      } finally {
        await prisma.telecomCredential.delete({ where: { id: cred.id } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
