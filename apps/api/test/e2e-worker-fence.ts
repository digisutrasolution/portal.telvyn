/**
 * Worker execution fence — INC-DB-001B-PRE2 finding N2.
 *
 * Started by test/setup-e2e.ts in EVERY E2E test-worker process (first beforeAll),
 * after the worker guard (test/e2e-guard.ts) has re-validated the targets. It opens ONE
 * dedicated session on the verified fixture database, joins the shared worker fence and
 * verifies that the exclusive run lease is held by exactly the lease session the global
 * setup published. It then keeps verifying both; if either is lost, a check fails, or
 * the check stalls, the worker terminates itself (terminateWorkerNow: SIGKILL, because
 * Vitest stubs process.exit inside workers). See test/e2e-run-lease.ts for the bounds.
 *
 * The session only takes / inspects advisory locks; it never reads or writes data.
 */
import { inject } from "vitest";
import { E2E_TARGET } from "./e2e-guard";
import { FENCE_CHECK_SQL, FENCE_SHARED_TRY_SQL, holdWorkerFence, terminateWorkerNow, type FenceDriver } from "./e2e-run-lease";

export const FENCE_APPLICATION_NAME = "telvyn-e2e-fence";

export async function startWorkerFence(): Promise<{ stop(): Promise<void> }> {
  let token: string | undefined;
  try {
    token = inject("telvynE2eLease");
  } catch {
    token = undefined;
  }
  // E2E_TARGET (Gate A + Gate B fingerprint) is already verified for this worker.
  void E2E_TARGET;
  const { PrismaClient } = await import("@prisma/client");
  const url = new URL(process.env.E2E_FIXTURE_DATABASE_URL as string);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("application_name", FENCE_APPLICATION_NAME);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const driver: FenceDriver = {
    tryShared: async () => Boolean((await db.$queryRawUnsafe<{ ok: boolean }[]>(FENCE_SHARED_TRY_SQL))[0]?.ok),
    check: async (lease) => {
      const row = (await db.$queryRawUnsafe<{ leaseOk: boolean; fenceOk: boolean }[]>(FENCE_CHECK_SQL, lease.pid, lease.started))[0];
      return { leaseOk: Boolean(row?.leaseOk), fenceOk: Boolean(row?.fenceOk) };
    },
    close: () => db.$disconnect(),
  };
  let fence: { stop(): Promise<void> };
  try {
    fence = await holdWorkerFence(driver, token);
  } catch (e) {
    // Fail closed before any of the file's own hooks (including cleanup) can run.
    terminateWorkerNow((e as Error).message);
  }
  // The main process owns the run; if its IPC channel goes away, stop at once.
  process.once("disconnect", () => terminateWorkerNow("main process disconnected"));
  return fence;
}
