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
  latestEvent?: { toStatus: HealthStatus } | null; // get() derivation (findFirst)
  listEvents?: { entityId: string; toStatus: HealthStatus }[]; // list() derivation (findMany, newest-first)
}) {
  const findManyEvents = vi.fn().mockResolvedValue(stub.listEvents ?? []);
  const prisma = {
    carrier: {
      findFirst: vi.fn().mockResolvedValue(stub.findFirstCarrier ?? null),
      findMany: vi.fn().mockResolvedValue(stub.findManyCarriers ?? []),
    },
    healthEvent: {
      findFirst: vi.fn().mockResolvedValue(stub.latestEvent ?? null),
      findMany: findManyEvents,
    },
  } as unknown as ConstructorParameters<typeof CarriersService>[0];
  const vault = {} as unknown as ConstructorParameters<typeof CarriersService>[1];
  return { service: new CarriersService(prisma, vault), findManyEvents };
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

  it("list(): derives per-carrier health in ONE bounded query (no N+1), newest-first dedupe, unprobed → UNKNOWN", async () => {
    const { service, findManyEvents } = makeService({
      findManyCarriers: [carrierRow("c1"), carrierRow("c2")],
      // newest-first (orderBy id desc): c1's newest is DISABLED (an older UNKNOWN follows); c2 has none.
      listEvents: [
        { entityId: "c1", toStatus: HealthStatus.DISABLED },
        { entityId: "c1", toStatus: HealthStatus.UNKNOWN },
      ],
    });
    const page = await service.list(ctx, listInput);

    expect(page.items.find((i) => i.id === "c1")!.health.status).toBe(HealthStatus.DISABLED); // newest wins
    expect(page.items.find((i) => i.id === "c2")!.health).toEqual({ status: HealthStatus.UNKNOWN, detail: "not yet probed" });
    // a single events query for ALL carriers (not a per-row lookup), ordered newest-first, no max(uuid)
    expect(findManyEvents).toHaveBeenCalledTimes(1);
    expect(findManyEvents).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: HealthEntityType.CARRIER, entityId: { in: ["c1", "c2"] } }, orderBy: { id: "desc" } }),
    );
  });

  it("list(): makes no health query for an empty page", async () => {
    const { service, findManyEvents } = makeService({ findManyCarriers: [] });
    const page = await service.list(ctx, listInput);
    expect(page.items).toHaveLength(0);
    expect(findManyEvents).not.toHaveBeenCalled();
  });
});
