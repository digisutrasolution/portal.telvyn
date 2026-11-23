import { describe, it, expect, vi } from "vitest";
import { KillSwitchService } from "./kill-switch.service";
import type { PrismaService } from "@/infra/prisma.service";
import type { AuditService } from "@/authz/audit.service";
import type { FraudEventsService } from "./fraud-events.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { RequestContext } from "@/common/request-context";

const CTX = { userId: "33333333-3333-7333-8333-333333333333", tenantId: "22222222-2222-7222-8222-222222222222" } as unknown as TenantContext;
const REQ = { ipAddress: "1.1.1.1", userAgent: "ua" } as unknown as RequestContext;

function makeService() {
  const killSwitch = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const prisma = { killSwitch } as unknown as PrismaService;
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const events = { record: vi.fn().mockResolvedValue(undefined) } as unknown as FraudEventsService;
  return { svc: new KillSwitchService(prisma, audit, events), killSwitch, audit, events };
}

describe("KillSwitchService reads", () => {
  it("returns a default inactive view when no row exists", async () => {
    const { svc, killSwitch } = makeService();
    killSwitch.findFirst.mockResolvedValue(null);
    const v = await svc.getTenant(CTX);
    expect(v).toMatchObject({ scope: "TENANT", active: false, version: 0 });
  });

  it("reads the GLOBAL switch by scope + null tenantId", async () => {
    const { svc, killSwitch } = makeService();
    killSwitch.findFirst.mockResolvedValue({ scope: "GLOBAL", active: true, reason: "incident", version: 3, activatedAt: new Date(), deactivatedAt: null, updatedAt: new Date() });
    const v = await svc.getGlobal();
    expect(killSwitch.findFirst.mock.calls[0][0].where).toMatchObject({ scope: "GLOBAL", tenantId: null });
    expect(v).toMatchObject({ scope: "GLOBAL", active: true, reason: "incident" });
  });
});

describe("KillSwitchService.setTenant (activate)", () => {
  it("creates the row if absent, flips it active, and audits + emits a KILL_SWITCH event", async () => {
    const { svc, killSwitch, audit, events } = makeService();
    killSwitch.findFirst.mockResolvedValue(null); // no existing row
    killSwitch.create.mockResolvedValue({ id: "ks1", scope: "TENANT", tenantId: CTX.tenantId, active: false });
    killSwitch.update.mockResolvedValue({ id: "ks1", scope: "TENANT", active: true, reason: "fraud spike", version: 2, activatedAt: new Date(), deactivatedAt: null, updatedAt: new Date() });

    const v = await svc.setTenant(CTX, REQ, true, "fraud spike");

    expect(killSwitch.create).toHaveBeenCalled();
    const upd = killSwitch.update.mock.calls[0][0];
    expect(upd.data).toMatchObject({ active: true, reason: "fraud spike", activatedBy: CTX.userId });
    expect(v).toMatchObject({ scope: "TENANT", active: true, reason: "fraud spike" });
    // Audit (specific action) + one KILL_SWITCH fraud event.
    expect((audit.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ action: "fraud.kill_switch.activated", resource: "kill_switch" });
    expect((events.record as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ type: "KILL_SWITCH", severity: "CRITICAL", code: "KILL_SWITCH_ACTIVATED" });
  });
});

describe("KillSwitchService.setGlobal (deactivate)", () => {
  it("records a WARNING KILL_SWITCH event with deactivatedBy", async () => {
    const { svc, killSwitch, events } = makeService();
    killSwitch.findFirst.mockResolvedValue({ id: "g1", scope: "GLOBAL", tenantId: null, active: true });
    killSwitch.update.mockResolvedValue({ id: "g1", scope: "GLOBAL", active: false, reason: null, version: 4, activatedAt: new Date(), deactivatedAt: new Date(), updatedAt: new Date() });

    await svc.setGlobal(CTX, REQ, false);

    const upd = killSwitch.update.mock.calls[0][0];
    expect(upd.data).toMatchObject({ active: false, deactivatedBy: CTX.userId });
    expect((events.record as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ type: "KILL_SWITCH", severity: "WARNING", code: "KILL_SWITCH_DEACTIVATED" });
  });
});
