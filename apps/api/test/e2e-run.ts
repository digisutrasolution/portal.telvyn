/**
 * Test-run ownership + scoped cleanup primitives — INC-DB-001B.
 *
 * Every fixture an E2E file creates is attributable to this run:
 *   - users      → email domain `<runId>.e2e.telvyn.test` (RUN_EMAIL_SUFFIX)
 *   - tenants    → reached only through run-owned users (slug ends with the
 *                  owning user's id) or a run-scoped name/slug prefix
 *   - named telecom/platform rows → run-scoped prefixes (runPrefix())
 *   - Redis      → rate-limit keys for loopback callers / run emails only;
 *                  fraud counters only for run-owned tenant ids
 * Cleanup deletes ONLY those. It never uses FLUSHDB/FLUSHALL/KEYS, never
 * disables triggers, and never deletes a GLOBAL singleton it did not create.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import type Redis from "ioredis";
import { E2E_TARGET } from "./e2e-guard";

/** Per-file run id: the verified global run id plus a per-file discriminator. */
export const RUN_ID = `${E2E_TARGET.runId}${Math.random().toString(36).slice(2, 6)}`;
export const RUN_EMAIL_DOMAIN = `${RUN_ID}.e2e.telvyn.test`;
export const RUN_EMAIL_SUFFIX = `@${RUN_EMAIL_DOMAIN}`;

/** A run-scoped name/label prefix, e.g. runPrefix("tstc") → "tstc-<runId>-". */
export const runPrefix = (p: string): string => `${p}-${RUN_ID}-`;

/** Prisma filter: users created by this run. */
export const ownedUserWhere = (): Prisma.UserWhereInput => ({ email: { endsWith: RUN_EMAIL_SUFFIX } });

/**
 * Prisma filter: tenants (optionally restricted to `names`) whose slug ends with
 * the id of a user created by this run. Resolve it BEFORE deleting the users.
 */
export async function ownedTenantWhere(prisma: PrismaClient, names?: readonly string[]): Promise<Prisma.TenantWhereInput> {
  const ids = (await prisma.user.findMany({ where: ownedUserWhere(), select: { id: true } })).map((u) => u.id);
  if (ids.length === 0) return { id: { in: [] } };
  return {
    ...(names ? { name: { in: [...names] } } : {}),
    OR: ids.map((id) => ({ slug: { endsWith: `-${id}` } })),
  };
}

/** Tenant ids owned by this run (see ownedTenantWhere). */
export async function ownedTenantIds(prisma: PrismaClient, names?: readonly string[]): Promise<string[]> {
  const where = await ownedTenantWhere(prisma, names);
  return (await prisma.tenant.findMany({ where, select: { id: true } })).map((t) => t.id);
}

/** Cursor-based SCAN (never KEYS). `pattern` must not be a bare "*". */
export async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  if (pattern === "*" || pattern.trim() === "") throw new Error("scanKeys: an unscoped pattern is not permitted");
  const out: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    out.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return out;
}

/** Callers the E2E harness itself presents to the rate limiter. */
export const LOOPBACK_KEYS: readonly string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/** True for a rate-limit key (`rl:<bucket>:<key>`) this run may reset. */
export function isRunRateLimitKey(redisKey: string, extraOwnedKeys: readonly string[] = []): boolean {
  const m = /^rl:[^:]+:(.*)$/.exec(redisKey);
  if (!m) return false;
  const key = m[1];
  return LOOPBACK_KEYS.includes(key) || key.toLowerCase().endsWith(RUN_EMAIL_SUFFIX.toLowerCase()) || extraOwnedKeys.includes(key);
}

/** Reset only the rate-limit windows this run's callers consumed. */
export async function resetRunRateLimits(redis: Redis, extraOwnedKeys: readonly string[] = []): Promise<number> {
  const keys = (await scanKeys(redis, "rl:*")).filter((k) => isRunRateLimitKey(k, extraOwnedKeys));
  if (keys.length) await redis.del(...keys);
  return keys.length;
}

/** True for a fraud counter key (`fraud:<kind>:<tenantId>[:...]`) owned by one of `tenantIds`. */
export function isOwnedFraudKey(redisKey: string, tenantIds: readonly string[]): boolean {
  const m = /^fraud:[^:]+:([^:]+)/.exec(redisKey);
  return !!m && tenantIds.includes(m[1]);
}

/** Delete fraud counters for run-owned tenants only. */
export async function clearFraudKeysFor(redis: Redis, tenantIds: readonly string[]): Promise<number> {
  if (tenantIds.length === 0) return 0;
  const keys = (await scanKeys(redis, "fraud:*")).filter((k) => isOwnedFraudKey(k, tenantIds));
  if (keys.length) await redis.del(...keys);
  return keys.length;
}

/**
 * Delete GLOBAL kill-switch rows created during this run: never one listed in
 * `preexisting` (snapshot taken before the run touched it), and only a row last
 * activated/deactivated by a run-owned user. Resolve BEFORE deleting run users.
 */
export async function deleteRunGlobalKillSwitches(prisma: PrismaClient, preexisting: readonly string[]): Promise<number> {
  const runUsers = (await prisma.user.findMany({ where: ownedUserWhere(), select: { id: true } })).map((u) => u.id);
  if (runUsers.length === 0) return 0;
  const r = await prisma.killSwitch.deleteMany({
    where: {
      scope: "GLOBAL",
      id: { notIn: [...preexisting] },
      OR: [{ activatedBy: { in: runUsers } }, { deactivatedBy: { in: runUsers } }],
    },
  });
  return r.count;
}
