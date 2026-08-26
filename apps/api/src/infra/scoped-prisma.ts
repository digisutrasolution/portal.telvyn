import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "@/authz/tenant-context";
import { applyTenantScope } from "@/authz/tenant-scope";

/**
 * Prisma client extension enforcing ADR-0004: every operation on a
 * tenant-owned model is scoped to the server-derived context tenantId, and an
 * unscoped access on such a model throws (deny-by-default). This is the single
 * sanctioned data path for tenant-owned entities.
 */
export function withTenantScope(prisma: PrismaClient) {
  return prisma.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const ctx = getTenantContext();
          const scoped = applyTenantScope(
            model,
            operation,
            (args ?? {}) as Record<string, unknown>,
            ctx?.tenantId,
          );
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof withTenantScope>;
