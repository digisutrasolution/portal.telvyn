import { describe, it, expect, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { DestinationRulesService } from "./destination-rules.service";
import { normalizeMatchValue } from "./destination-rules.dto";
import { DestinationMatchType } from "@prisma/client";
import type { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { CreateDestinationRuleInput, UpdateDestinationRuleInput } from "./destination-rules.dto";

const CTX = { userId: "u", tenantId: "22222222-2222-7222-8222-222222222222" } as unknown as TenantContext;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-7111-8111-111111111111",
    tenantId: "SHOULD_NEVER_LEAK",
    matchType: "COUNTRY",
    matchValue: "NG",
    action: "DENY",
    riskClass: "HIGH_COST",
    enabled: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

function makeService() {
  const scoped = { destinationRule: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() } };
  const raw = { updateMany: vi.fn(), update: vi.fn() };
  const prisma = { scoped, destinationRule: raw } as unknown as PrismaService;
  return { svc: new DestinationRulesService(prisma), scoped, raw };
}

describe("normalizeMatchValue", () => {
  it("uppercases a COUNTRY and strips a leading + from a PREFIX", () => {
    expect(normalizeMatchValue(DestinationMatchType.COUNTRY, "ng")).toBe("NG");
    expect(normalizeMatchValue(DestinationMatchType.PREFIX, "+44")).toBe("44");
    expect(normalizeMatchValue(DestinationMatchType.PREFIX, "1900")).toBe("1900");
  });
});

describe("DestinationRulesService.view (safe view)", () => {
  it("returns the rule fields and hides tenantId/deletedAt", async () => {
    const { svc, scoped } = makeService();
    scoped.destinationRule.findFirst.mockResolvedValue(row());
    const v = await svc.get(CTX, "x");
    expect(v).toMatchObject({ matchType: "COUNTRY", matchValue: "NG", action: "DENY", riskClass: "HIGH_COST" });
    expect(v).not.toHaveProperty("tenantId");
    expect(v).not.toHaveProperty("deletedAt");
  });
});

describe("DestinationRulesService.create", () => {
  it("normalizes the match value, checks the duplicate on the normalized value, and 409s", async () => {
    const { svc, scoped } = makeService();
    scoped.destinationRule.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      svc.create(CTX, { matchType: "PREFIX", matchValue: "+44", action: "DENY" } as CreateDestinationRuleInput),
    ).rejects.toThrow(ConflictException);
    // The duplicate check used the normalized value ("44", not "+44").
    expect(scoped.destinationRule.findFirst.mock.calls[0][0].where).toMatchObject({ matchType: "PREFIX", matchValue: "44" });
    expect(scoped.destinationRule.create).not.toHaveBeenCalled();
  });

  it("creates when none exists, stamping tenantId and storing the normalized value", async () => {
    const { svc, scoped } = makeService();
    scoped.destinationRule.findFirst.mockResolvedValue(null);
    scoped.destinationRule.create.mockResolvedValue(row());
    await svc.create(CTX, { matchType: "COUNTRY", matchValue: "ng", action: "DENY", riskClass: "HIGH_COST" } as CreateDestinationRuleInput);
    const data = scoped.destinationRule.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(CTX.tenantId);
    expect(data.matchValue).toBe("NG"); // normalized
    expect(data.riskClass).toBe("HIGH_COST");
  });
});

describe("DestinationRulesService.update", () => {
  it("throws 409 on a version mismatch (optimistic concurrency)", async () => {
    const { svc, scoped, raw } = makeService();
    scoped.destinationRule.findFirst.mockResolvedValue(row());
    raw.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.update(CTX, "x", { action: "ALLOW", expectedVersion: 1 } as UpdateDestinationRuleInput),
    ).rejects.toThrow(ConflictException);
  });

  it("404s updating a foreign/unknown rule (scoped load miss)", async () => {
    const { svc, scoped } = makeService();
    scoped.destinationRule.findFirst.mockResolvedValue(null);
    await expect(svc.update(CTX, "x", { action: "ALLOW" } as UpdateDestinationRuleInput)).rejects.toThrow(NotFoundException);
  });
});
