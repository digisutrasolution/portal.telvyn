import { describe, expect, it, vi } from "vitest";
import { HealthEntityType, HealthStatus, TelecomStatus, TenantType } from "@prisma/client";
import { CarrierHealthService } from "./carrier-health.service";
import type { TenantContext } from "@/authz/tenant-context";

const ctx: TenantContext = { userId: "u1", tenantId: "t1", tenantType: TenantType.CUSTOMER, roles: [], permissions: [] } as unknown as TenantContext;

/** A prisma stub: a configurable carrier (with/without endpoints) + last CARRIER event. */
function makeService(opts: {
  carrier: { id: string; tenantId: string | null; status: TelecomStatus; hasEndpoint: boolean } | null;
  lastEventToStatus?: HealthStatus | null;
}) {
  const healthEventCreate = vi.fn().mockResolvedValue({});
  const carrierRow = opts.carrier
    ? { id: opts.carrier.id, tenantId: opts.carrier.tenantId, status: opts.carrier.status, sipEndpoints: opts.carrier.hasEndpoint ? [{ id: "ep1" }] : [] }
    : null;
  const prisma = {
    carrier: { findFirst: vi.fn().mockResolvedValue(carrierRow) },
    healthEvent: {
      findFirst: vi.fn().mockResolvedValue(opts.lastEventToStatus == null ? null : { toStatus: opts.lastEventToStatus }),
      create: healthEventCreate,
    },
  } as unknown as ConstructorParameters<typeof CarrierHealthService>[0];
  return { service: new CarrierHealthService(prisma), healthEventCreate };
}

describe("CarrierHealthService.probe", () => {
  it("resolves an UNVERIFIED posture (active, has endpoint) to honest UNKNOWN and records the first transition", async () => {
    const { service, healthEventCreate } = makeService({
      carrier: { id: "c1", tenantId: "t1", status: TelecomStatus.ACTIVE, hasEndpoint: true },
      lastEventToStatus: null,
    });
    const report = await service.probe(ctx, "c1", "corr-1");

    expect(report).toEqual({
      carrierId: "c1",
      status: HealthStatus.UNKNOWN,
      reachability: "UNVERIFIED",
      detail: expect.stringContaining("unverified"),
      correlationId: "corr-1",
      checkedAt: expect.any(Date),
    });
    expect(healthEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: HealthEntityType.CARRIER,
          entityId: "c1",
          tenantId: "t1", // the carrier's owner, not null
          fromStatus: null,
          toStatus: HealthStatus.UNKNOWN,
        }),
      }),
    );
  });

  it("reports UNCONFIGURED when the carrier has no SIP endpoint", async () => {
    const { service } = makeService({ carrier: { id: "c1", tenantId: null, status: TelecomStatus.ACTIVE, hasEndpoint: false }, lastEventToStatus: null });
    const report = await service.probe(ctx, "c1", "corr-1");
    expect(report.reachability).toBe("UNCONFIGURED");
    expect(report.status).toBe(HealthStatus.UNKNOWN);
  });

  it("maps an administratively DISABLED carrier to DISABLED (never fabricated)", async () => {
    const { service } = makeService({ carrier: { id: "c1", tenantId: null, status: TelecomStatus.DISABLED, hasEndpoint: true }, lastEventToStatus: null });
    const report = await service.probe(ctx, "c1", "corr-1");
    expect(report.reachability).toBe("DISABLED");
    expect(report.status).toBe(HealthStatus.DISABLED);
  });

  it("carries the carrier's null tenantId for a system carrier event", async () => {
    const { service, healthEventCreate } = makeService({ carrier: { id: "c1", tenantId: null, status: TelecomStatus.ACTIVE, hasEndpoint: true }, lastEventToStatus: null });
    await service.probe(ctx, "c1", "corr-1");
    expect(healthEventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: null }) }));
  });

  it("does NOT write a new event when the status is unchanged", async () => {
    const { service, healthEventCreate } = makeService({
      carrier: { id: "c1", tenantId: "t1", status: TelecomStatus.ACTIVE, hasEndpoint: true },
      lastEventToStatus: HealthStatus.UNKNOWN, // already UNKNOWN
    });
    await service.probe(ctx, "c1", "corr-1");
    expect(healthEventCreate).not.toHaveBeenCalled();
  });

  it("404s for a foreign/unknown carrier (scope-resolved)", async () => {
    const { service } = makeService({ carrier: null });
    await expect(service.probe(ctx, "missing", "corr-1")).rejects.toThrow(/not found/i);
  });
});
