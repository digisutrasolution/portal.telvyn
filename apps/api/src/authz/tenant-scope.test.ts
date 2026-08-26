import { describe, expect, it } from "vitest";
import { applyTenantScope, TenantScopeError, TENANT_SCOPED_MODELS } from "./tenant-scope";

const TID = "11111111-1111-7111-8111-111111111111";

describe("applyTenantScope (data-layer isolation, ADR-0004)", () => {
  it("leaves non-tenant models untouched", () => {
    const args = { where: { email: "a@b.c" } };
    expect(applyTenantScope("User", "findUnique", args, undefined)).toBe(args);
  });

  it("REFUSES a tenant-owned query with no context (deny-by-default)", () => {
    expect(() => applyTenantScope("Membership", "findMany", {}, undefined)).toThrow(TenantScopeError);
    expect(() => applyTenantScope("Role", "create", { data: {} }, undefined)).toThrow(TenantScopeError);
  });

  it("injects tenantId into list/read where-clauses", () => {
    const out = applyTenantScope("Membership", "findMany", { where: { status: "ACTIVE" } }, TID);
    expect(out.where).toEqual({ status: "ACTIVE", tenantId: TID });
  });

  it("wraps unique reads in AND so a foreign id resolves to not-found (IDOR)", () => {
    const out = applyTenantScope("Role", "findUnique", { where: { id: "other" } }, TID);
    expect(out.where).toEqual({ AND: [{ id: "other" }, { tenantId: TID }] });
  });

  it("injects tenantId into create data", () => {
    const out = applyTenantScope("Role", "create", { data: { key: "x" } }, TID);
    expect(out.data).toEqual({ key: "x", tenantId: TID });
  });

  it("injects tenantId into every createMany row", () => {
    const out = applyTenantScope("Membership", "createMany", { data: [{ userId: "u1" }, { userId: "u2" }] }, TID);
    expect(out.data).toEqual([
      { userId: "u1", tenantId: TID },
      { userId: "u2", tenantId: TID },
    ]);
  });

  it("scopes the audit log", () => {
    expect(TENANT_SCOPED_MODELS.has("AuditLog")).toBe(true);
  });
});
