import { AsyncLocalStorage } from "node:async_hooks";

/** Request-scoped authorization context, derived server-side (never from client input). */
export interface TenantContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  /** Expanded, concrete permission keys granted to this membership. */
  permissions: ReadonlySet<string>;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The active context, or undefined outside a tenant-scoped request. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
