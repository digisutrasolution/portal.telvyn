/**
 * Mandatory data-layer tenant scoping (ADR-0004). A Prisma client extension
 * routes every operation on a tenant-owned model through `applyTenantScope`,
 * which injects the server-derived tenantId into the query and REFUSES to run
 * an unscoped query (deny-by-default). Extracted as a pure function so the
 * behavior is unit-tested without a database.
 */

/**
 * Models that carry a REQUIRED tenantId and must always be tenant-scoped by the
 * auto-scoping client (deny-by-default + IDOR-safe). Dual-nature models
 * (Carrier, TelecomCredential) are NOT here — they use the system-or-tenant
 * helpers below instead.
 */
export const TENANT_SCOPED_MODELS = new Set(["Membership", "Role", "AuditLog", "SipTrunk", "Did", "RoutingProfile", "LcrPolicy"]);

// ---------------------------------------------------------------------------
// System-or-tenant scope (ADR-0008). Dual-nature models (Carrier,
// TelecomCredential, …) may be platform-owned (tenantId = null) OR tenant-owned
// (tenantId set). The auto-scoping client above cannot express "own tenant OR
// system", so these models use the RAW client with the helpers below —
// expressed ONCE, here, and unit-tested — instead of scattered raw `OR` filters.
// ---------------------------------------------------------------------------

/** READ filter: a caller sees its own rows plus system (platform) rows. */
export function systemOrTenantWhere(tenantId: string): {
  OR: [{ tenantId: string }, { tenantId: null }];
} {
  return { OR: [{ tenantId }, { tenantId: null }] };
}

/** Outcome of authorizing a WRITE against a dual-nature row. */
export type DualNatureWrite = "allow" | "forbidden_system" | "not_found";

/**
 * WRITE authorization for a dual-nature row:
 *   - system row (tenantId null): only a PLATFORM caller may write; a tenant
 *     caller is `forbidden_system` (it can read the row but not mutate it).
 *   - own tenant row: allowed.
 *   - another tenant's row: `not_found` — IDOR-safe (never disclose existence).
 * Scope is derived from the authenticated context, never from client input.
 */
export function authorizeDualNatureWrite(
  rowTenantId: string | null,
  ctx: { tenantId: string; isPlatform: boolean },
): DualNatureWrite {
  if (rowTenantId === null) return ctx.isPlatform ? "allow" : "forbidden_system";
  if (rowTenantId === ctx.tenantId) return "allow";
  return "not_found";
}

/**
 * Owner tenantId to STAMP on a newly created dual-nature row, derived from
 * context: a PLATFORM caller creates a system row (null); any other tenant
 * creates a row it owns. The client never supplies this.
 */
export function ownerTenantIdForCreate(ctx: { tenantId: string; isPlatform: boolean }): string | null {
  return ctx.isPlatform ? null : ctx.tenantId;
}

/** Thrown when a tenant-owned model is accessed without a tenant context. */
export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(`Refused unscoped ${operation} on tenant-owned model ${model}: no tenant context`);
    this.name = "TenantScopeError";
  }
}

const READS = new Set(["findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);
const UNIQUE_READS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);
const CREATES = new Set(["create", "createMany"]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown };

/**
 * Return a NEW args object with the tenantId enforced for `model`/`operation`.
 * `tenantId` undefined + a scoped model → throws (deny-by-default).
 */
export function applyTenantScope(model: string, operation: string, args: Args, tenantId: string | undefined): Args {
  if (!TENANT_SCOPED_MODELS.has(model)) return args;
  if (!tenantId) throw new TenantScopeError(model, operation);

  if (READS.has(operation)) {
    return { ...args, where: { ...(args.where ?? {}), tenantId } };
  }

  if (UNIQUE_READS.has(operation)) {
    // Wrap the unique selector in an AND so a foreign-tenant id resolves to
    // "not found" (IDOR protection) rather than leaking the row.
    const where = (args.where ?? {}) as Record<string, unknown>;
    return { ...args, where: { AND: [where, { tenantId }] } };
  }

  if (CREATES.has(operation)) {
    if (operation === "createMany") {
      const rows = Array.isArray((args.data as { data?: unknown })?.data)
        ? ((args.data as { data: Record<string, unknown>[] }).data)
        : (args.data as Record<string, unknown>[]);
      const scoped = (rows ?? []).map((r) => ({ ...r, tenantId }));
      return { ...args, data: scoped };
    }
    return { ...args, data: { ...((args.data as Record<string, unknown>) ?? {}), tenantId } };
  }

  // Unknown operation on a scoped model — fail closed.
  throw new TenantScopeError(model, operation);
}
