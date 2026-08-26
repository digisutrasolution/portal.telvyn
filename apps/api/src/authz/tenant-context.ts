import { AsyncLocalStorage } from "node:async_hooks";

/** Request-scoped authorization context, derived server-side (never from client input). */
export interface TenantContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  /** Expanded, concrete permission keys granted to this membership. */
  permissions: ReadonlySet<string>;
}

/**
 * A mutable holder is seeded by middleware at the START of every request, so
 * the AsyncLocalStorage store is active for the whole guard→handler chain.
 * The TenantGuard fills `ctx` in; the scoped Prisma client reads it later in
 * the handler. (Binding the store in the guard alone does not survive back up
 * to Nest's awaiting pipeline — hence the middleware seed.)
 */
interface Store {
  ctx: TenantContext | null;
}

const storage = new AsyncLocalStorage<Store>();

/** Middleware entrypoint: run the rest of the request inside a fresh store. */
export function seedTenantStore(next: () => void): void {
  storage.run({ ctx: null }, next);
}

/** Guard entrypoint: attach the resolved context to the active request store. */
export function setTenantContext(ctx: TenantContext): void {
  const store = storage.getStore();
  if (store) store.ctx = ctx;
}

/** The active context, or undefined outside a tenant-scoped request. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore()?.ctx ?? undefined;
}

/** Test/helper entrypoint: run a function with a fixed context. */
export function runWithTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run({ ctx }, fn);
}
