import { describe, expect, it, vi } from "vitest";
import { HealthEntityType, HealthStatus, TelecomStatus, TenantType } from "@prisma/client";
import { CarriersService } from "./carriers.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { ListCarriersInput } from "./carriers.dto";

const ctx: TenantContext = { userId: "u1", tenantId: "t1", tenantType: TenantType.CUSTOMER, roles: [], permissions: [] } as unknown as TenantContext;

function carrierRow(id: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    tenantId: "t1",
    name: `carrier-${id}`,
    type: null,
    country: null,
    regionId: null,
    status: TelecomStatus.ACTIVE,
    priority: 100,
    codecs: [],
    maxCps: null,
    maxConcurrentCalls: null,
    credential: null,
    createdAt: new Date("2026-11-20T00:00:00.000Z"),
    updatedAt: new Date("2026-11-20T00:00:00.000Z"),
    ...over,
  };
}

/** Prisma stub exposing the queries get()/list() use, with configurable health events. */
function makeService(stub: {
  findFirstCarrier?: ReturnType<typeof carrierRow> | null;
  findManyCarriers?: ReturnType<typeof carrierRow>[];
  latestEvent?: { toStatus: HealthStatus } | null; // get() derivation
  groupBy?: { entityId: string; _max: { id: string | null } }[]; // list() step 1
  eventsById?: { entityId: string; toStatus: HealthStatus }[]; // list() step 2
}) {
  const groupBy = vi.fn().mockResolvedValue(stub.groupBy ?? []);
  const findManyEvents = vi.fn().mockResolvedValue(stub.eventsById ?? []);
  const prisma = {
    carrier: {
      findFirst: vi.fn().mockResolvedValue(stub.findFirstCarrier ?? null),
      findMany: vi.fn().mockResolvedValue(stub.findManyCarriers ?? []),
    },
    healthEvent: {
      findFirst: vi.fn().mockResolvedValue(stub.latestEvent ?? null),
      groupBy,
      findMany: findManyEvents,
    },
  } as unknown as ConstructorParameters<typeof CarriersService>[0];
  const vault = {} as unknown as ConstructorParameters<typeof CarriersService>[1];
  return { service: new CarriersService(prisma, vault), groupBy, findManyEvents };
}

const listInput: ListCarriersInput = { limit: 25, scope: "all" } as ListCarriersInput;

describe("CarriersService health derivation", () => {
  it("get(): derives health from the latest CARRIER event", async () => {
    const { service } = makeService({ findFirstCarrier: carrierRow("c1"), latestEvent: { toStatus: HealthStatus.DISABLED } });
    const view = await service.get(ctx, "c1");
    expect(view.health).toEqual({ status: HealthStatus.DISABLED, detail: "last operator health probe" });
  });

  it("get(): honest UNKNOWN / not-yet-probed when the carrier has no event", async () => {
    const { service } = makeService({ findFirstCarrier: carrierRow("c1"), latestEvent: null });
    const view = await service.get(ctx, "c1");
    expect(view.health).toEqual({ status: HealthStatus.UNKNOWN, detail: "not yet probed" });
  });

  it("list(): derives per-carrier health in two bounded queries (no N+1) and leaves unprobed carriers UNKNOWN", async () => {
    const { service, groupBy, findManyEvents } = makeService({
      findManyCarriers: [carrierRow("c1"), carrierRow("c2")],
      groupBy: [{ entityId: "c1", _max: { id: "evt-c1" } }], // only c1 has events
      eventsById: [{ entityId: "c1", toStatus: HealthStatus.DISABLED }],
    });
    const page = await service.list(ctx, listInput);

    expect(page.items.find((i) => i.id === "c1")!.health.status).toBe(HealthStatus.DISABLED);
    expect(page.items.find((i) => i.id === "c2")!.health).toEqual({ status: HealthStatus.UNKNOWN, detail: "not yet probed" });
    // exactly one groupBy + one findMany regardless of carrier count — not a per-row lookup
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["entityId"], where: expect.objectContaining({ entityType: HealthEntityType.CARRIER, entityId: { in: ["c1", "c2"] } }) }));
    expect(findManyEvents).toHaveBeenCalledTimes(1);
    expect(findManyEvents).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["evt-c1"] } } }));
  });

  it("list(): makes no health query for an empty page", async () => {
    const { service, groupBy } = makeService({ findManyCarriers: [] });
    const page = await service.list(ctx, listInput);
    expect(page.items).toHaveLength(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
