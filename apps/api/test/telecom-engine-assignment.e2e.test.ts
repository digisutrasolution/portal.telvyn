import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12N-1 — Engine↔resource assignment (additive schema) integration test.
 *
 * Proves migration `engine_resource_assignment` against real Postgres: a resource
 * (SIP trunk / DID / routing profile) can be assigned to an engine; the same
 * resource can't be assigned twice to one engine (unique); the DB CHECK rejects
 * zero/two resources and a kind↔resource mismatch; and cascades clean up when an
 * engine or a resource is hard-deleted. Pure data-layer — no app/Redis.
 */
import { afterAll, describe, expect, it } from "vitest";
import { EngineResourceKind, TelecomEngineType } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://telvyn:telvyn_dev@localhost:5432/telvyn?schema=public";

const prisma = fixturePrisma;
const TAG = `tnra-${Date.now()}`;
let seq = 0;

async function fixtures() {
  const u = `${TAG}-${seq++}`;
  const tenant = await prisma.tenant.create({ data: { slug: `${u}-t`, name: `${u}`, type: "CUSTOMER" } });
  const engine = await prisma.telecomEngine.create({ data: { name: `${u}-eng`, type: TelecomEngineType.KAMAILIO } });
  const carrier = await prisma.carrier.create({ data: { name: `${u}-car`, tenantId: tenant.id } });
  const trunk = await prisma.sipTrunk.create({ data: { name: `${u}-trunk`, tenantId: tenant.id, carrierId: carrier.id } });
  const did = await prisma.did.create({ data: { e164: `+1999${String(1000000 + seq).slice(-7)}`, country: "US", tenantId: tenant.id } });
  const profile = await prisma.routingProfile.create({ data: { name: `${u}-rp`, tenantId: tenant.id } });
  return { tenant, engine, carrier, trunk, did, profile };
}

afterAll(async () => {
  await prisma.engineResourceAssignment.deleteMany({ where: { engine: { name: { startsWith: TAG } } } });
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.did.deleteMany({ where: { e164: { startsWith: "+1999" }, tenant: { name: { startsWith: TAG } } } });
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.routingProfile.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.tenant.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("Phase 12N-1 — EngineResourceAssignment (additive schema)", () => {
  it("assigns each resource kind to an engine and reads them back", async () => {
    const f = await fixtures();
    const t = await prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.SIP_TRUNK, tenantId: f.tenant.id, sipTrunkId: f.trunk.id } });
    const d = await prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.DID, tenantId: f.tenant.id, didId: f.did.id } });
    const r = await prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.ROUTING_PROFILE, tenantId: f.tenant.id, routingProfileId: f.profile.id } });
    expect([t.sipTrunkId, d.didId, r.routingProfileId]).toEqual([f.trunk.id, f.did.id, f.profile.id]);
    const count = await prisma.engineResourceAssignment.count({ where: { engineId: f.engine.id } });
    expect(count).toBe(3);
  });

  it("rejects assigning the same resource to the same engine twice (unique)", async () => {
    const f = await fixtures();
    await prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.SIP_TRUNK, sipTrunkId: f.trunk.id } });
    await expect(
      prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.SIP_TRUNK, sipTrunkId: f.trunk.id } }),
    ).rejects.toThrow();
  });

  it("CHECK rejects zero resources, two resources, and kind↔resource mismatch", async () => {
    const f = await fixtures();
    // zero resources
    await expect(prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.SIP_TRUNK } })).rejects.toThrow();
    // two resources set
    await expect(
      prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.SIP_TRUNK, sipTrunkId: f.trunk.id, didId: f.did.id } }),
    ).rejects.toThrow();
    // kind says DID but a routing profile is set
    await expect(
      prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.DID, routingProfileId: f.profile.id } }),
    ).rejects.toThrow();
  });

  it("cascades: deleting the engine removes its assignments; deleting a resource removes its assignment", async () => {
    const f = await fixtures();
    await prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.SIP_TRUNK, sipTrunkId: f.trunk.id } });
    await prisma.engineResourceAssignment.create({ data: { engineId: f.engine.id, kind: EngineResourceKind.DID, didId: f.did.id } });

    // delete the DID → its assignment is gone, the trunk one remains
    await prisma.did.delete({ where: { id: f.did.id } });
    expect(await prisma.engineResourceAssignment.count({ where: { engineId: f.engine.id } })).toBe(1);

    // delete the engine → the remaining assignment is gone
    await prisma.telecomEngine.delete({ where: { id: f.engine.id } });
    expect(await prisma.engineResourceAssignment.count({ where: { engineId: f.engine.id } })).toBe(0);
  });
});
