/**
 * E2E per-file setup (Slice 13-1A.4b; replaced by the two-stage guard in
 * INC-DB-001B). Runs before each E2E file is imported: re-validates Gate A on
 * the worker environment and requires the global setup's Gate B verification
 * of the same targets (see test/e2e-target-guard.ts).
 *
 * INC-DB-001B-PRE2 (N2): registers the worker execution fence as the FIRST
 * beforeAll and the LAST afterAll of every file (setup-file hooks are registered
 * before the file's own; Vitest's default "stack" order runs after-hooks in
 * reverse). The fence terminates this worker if the exclusive run lease is lost
 * (see test/e2e-worker-fence.ts); if it cannot be joined, the worker exits
 * before any of the file's own hooks run.
 */
import { afterAll, beforeAll } from "vitest";
import "./e2e-guard";
import { startWorkerFence } from "./e2e-worker-fence";

let fence: { stop(): Promise<void> } | undefined;
beforeAll(async () => {
  fence = await startWorkerFence();
});
afterAll(async () => {
  await fence?.stop();
});
