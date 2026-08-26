/**
 * Mandatory data-layer tenant scoping (ADR-0004). A Prisma client extension
 * routes every operation on a tenant-owned model through `applyTenantScope`,
 * which injects the server-derived tenantId into the query and REFUSES to run
 * an unscoped query (deny-by-default). Extracted as a pure function so the
 * behavior is unit-tested without a database.
 */

/** Models that carry a tenantId and must always be tenant-scoped. */
export const TENANT_SCOPED_MODELS = new Set(["Membership", "Role", "AuditLog"]);

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
