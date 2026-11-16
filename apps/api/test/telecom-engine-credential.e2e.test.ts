/**
 * Phase 12M-1 — Engine credential reference (additive schema) integration test.
 *
 * Proves the migration `20261116231958_engine_credential_ref` against real
 * Postgres: the `ENGINE_API` credential type exists and is usable, a
 * `TelecomEngine` can reference a management-plane credential in the vault, and
 * deleting that credential SET NULLs the reference (never orphaning/deleting the
 * engine). No app/Redis needed — this is a pure data-layer schema assertion.
 *
 * Secrets are out of scope here (the vault service owns encryption); this test
 * exercises the FK/enum/relation only, with a placeholder non-secret value.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, TelecomCredentialType, TelecomEngineType } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://telvyn:telvyn_dev@localhost:5432/telvyn?schema=public";

const prisma = new PrismaClient();
const TAG = `tmc1-${Date.now()}`;

afterAll(async () => {
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.telecomCredential.deleteMany({ where: { label: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("Phase 12M-1 — TelecomEngine.credentialId (additive schema)", () => {
  it("accepts the ENGINE_API credential type and links it to an engine, readable via the relation", async () => {
    const cred = await prisma.telecomCredential.create({
      data: {
        tenantId: null, // platform-scoped engine credential
        type: TelecomCredentialType.ENGINE_API,
        label: `${TAG}-mtls`,
        hint: "client-cert",
        secretEnc: "placeholder.not-a-real-secret.schema-test",
      },
    });

    const engine = await prisma.telecomEngine.create({
      data: { name: `${TAG}-kam`, type: TelecomEngineType.KAMAILIO, credentialId: cred.id },
      include: { credential: true },
    });

    expect(engine.credentialId).toBe(cred.id);
    expect(engine.credential?.type).toBe(TelecomCredentialType.ENGINE_API);
  });

  it("defaults credentialId to null when no credential is referenced", async () => {
    const engine = await prisma.telecomEngine.create({
      data: { name: `${TAG}-nocred`, type: TelecomEngineType.KAMAILIO },
    });
    expect(engine.credentialId).toBeNull();
  });

  it("SET NULLs the reference when the credential is deleted (engine row survives)", async () => {
    const cred = await prisma.telecomCredential.create({
      data: {
        tenantId: null,
        type: TelecomCredentialType.ENGINE_API,
        label: `${TAG}-ephemeral`,
        secretEnc: "placeholder.not-a-real-secret.schema-test",
      },
    });
    const engine = await prisma.telecomEngine.create({
      data: { name: `${TAG}-survivor`, type: TelecomEngineType.KAMAILIO, credentialId: cred.id },
    });

    await prisma.telecomCredential.delete({ where: { id: cred.id } });

    const after = await prisma.telecomEngine.findUniqueOrThrow({ where: { id: engine.id } });
    expect(after.id).toBe(engine.id); // engine not cascaded away
    expect(after.credentialId).toBeNull(); // reference cleared, not orphaned
  });
});
