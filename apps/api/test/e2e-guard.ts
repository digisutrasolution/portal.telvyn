/**
 * Worker-side E2E guard — INC-DB-001B. Every E2E file imports this FIRST
 * (before the app, Prisma or Redis), and `fixture-db.ts` imports it too.
 *
 * It re-runs Gate A on the worker's environment and requires that the global
 * setup's Gate B verified exactly these targets (credential-free fingerprint
 * handed over via Vitest provide/inject). A file executed outside the guarded
 * E2E lane — e.g. through a config without the global setup — has nothing to
 * inject and fails here, before any client is constructed.
 */
import { inject } from "vitest";
import { E2eTargetError, validateGateA, type GateAResult } from "./e2e-target-guard";

function assertWorkerTarget(): GateAResult & { runId: string } {
  const a = validateGateA(process.env);
  let verified: string | undefined;
  let runId: string | undefined;
  try {
    verified = inject("telvynE2eFingerprint");
    runId = inject("telvynE2eRunId");
  } catch {
    verified = undefined;
  }
  if (!verified || !runId) {
    throw new E2eTargetError("B", "NOT_VERIFIED", "no Gate B verification for this run; use `pnpm --filter @telvyn/api test:e2e` (vitest.e2e.config.ts).");
  }
  if (verified !== a.fingerprint) {
    throw new E2eTargetError("B", "TARGET_CHANGED", "worker targets differ from the targets Gate B verified; refusing.");
  }
  return { ...a, runId };
}

export const E2E_TARGET = assertWorkerTarget();

process.env.NODE_ENV = "test";
