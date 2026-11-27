import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Transaction-client provenance (Phase 13-2B S5, prerequisite P5).
 *
 * Financial writes must run inside an interactive transaction that THIS process
 * opened for them. Two independent checks:
 *
 *  1. In-process provenance: `runInTrackedTransaction` registers the exact
 *     transaction client Prisma hands to the callback in a module-private
 *     WeakSet for the callback's lifetime. A base client, a scoped client, a
 *     hand-made object or a transaction client that has already finished is
 *     not in the set. The set cannot be written from outside this module.
 *  2. Database provenance (`assertLiveTransaction`): sets a random,
 *     TRANSACTION-LOCAL setting on the client's connection and reads it back
 *     in a second statement. The value survives only if both statements ran on
 *     the same connection inside one open transaction block — an autocommit
 *     client fails the check.
 *
 * Neither check is a security boundary against code that already runs with the
 * runtime database role; they stop accidental or partial use of a non-atomic
 * client on the normal application path.
 */
const TRACKED = new WeakSet<object>();

export type TrackedTx = Prisma.TransactionClient;

export async function runInTrackedTransaction<T>(
  prisma: Pick<PrismaClient, "$transaction">,
  fn: (tx: TrackedTx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    TRACKED.add(tx);
    try {
      return await fn(tx);
    } finally {
      TRACKED.delete(tx);
    }
  }, options);
}

/** True only for a transaction client currently inside runInTrackedTransaction. */
export function isTrackedTransaction(tx: unknown): tx is TrackedTx {
  return typeof tx === "object" && tx !== null && TRACKED.has(tx);
}

export class TransactionProvenanceError extends Error {
  constructor(detail: string) {
    super(`transaction provenance check failed: ${detail}`);
    this.name = "TransactionProvenanceError";
  }
}

/** Database-level proof that `tx` is an open transaction block on one connection. */
export async function assertLiveTransaction(tx: TrackedTx): Promise<void> {
  const nonce = randomUUID();
  await tx.$queryRaw`SELECT pg_catalog.set_config('app.tx_probe', ${nonce}, true)`;
  const rows = await tx.$queryRaw<Array<{ v: string | null }>>`SELECT pg_catalog.current_setting('app.tx_probe', true) AS v`;
  if (rows[0]?.v !== nonce) throw new TransactionProvenanceError("not an open transaction block");
}
