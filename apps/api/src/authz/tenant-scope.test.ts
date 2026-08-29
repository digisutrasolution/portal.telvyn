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

import { authorizeDualNatureWrite, ownerTenantIdForCreate, systemOrTenantWhere } from "./tenant-scope";

describe("system-or-tenant scope (ADR-0008)", () => {
  const TA = "11111111-1111-7111-8111-111111111111";
  const TB = "22222222-2222-7222-8222-222222222222";

  it("read filter returns own-tenant OR system rows", () => {
    expect(systemOrTenantWhere(TA)).toEqual({ OR: [{ tenantId: TA }, { tenantId: null }] });
  });

  it("create stamps system (null) for platform, own tenant otherwise", () => {
    expect(ownerTenantIdForCreate({ tenantId: TA, isPlatform: true })).toBeNull();
    expect(ownerTenantIdForCreate({ tenantId: TA, isPlatform: false })).toBe(TA);
  });

  it("authorizes writes: own=allow, system=platform-only, foreign=not_found", () => {
    // own tenant row
    expect(authorizeDualNatureWrite(TA, { tenantId: TA, isPlatform: false })).toBe("allow");
    // system row: platform allowed, tenant forbidden
    expect(authorizeDualNatureWrite(null, { tenantId: TA, isPlatform: true })).toBe("allow");
    expect(authorizeDualNatureWrite(null, { tenantId: TA, isPlatform: false })).toBe("forbidden_system");
    // another tenant's row → IDOR-safe not_found
    expect(authorizeDualNatureWrite(TB, { tenantId: TA, isPlatform: false })).toBe("not_found");
    expect(authorizeDualNatureWrite(TB, { tenantId: TA, isPlatform: true })).toBe("not_found");
  });
});
