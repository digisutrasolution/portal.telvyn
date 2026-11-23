import { z } from "zod";

/**
 * Preview (dry-run) authorization request (Phase 12R-4). `destination` is a raw
 * dialled number (normalized to E.164 server-side). `estimatedCostMicros` is an
 * integer in millionths of a currency unit, used only for the per-call /
 * period spend checks.
 */
export const PreviewAuthorizationDto = z
  .object({
    destination: z.string().min(1).max(32),
    estimatedCostMicros: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
  })
  .strict();

export type PreviewAuthorizationInput = z.infer<typeof PreviewAuthorizationDto>;

/** Integer micros (millionths of a currency unit) — never floating point. */
const micros = z.number().int().min(0).max(1_000_000_000_000_000);
/** Idempotency key for a call attempt — the token used to settle/release it. */
const callKey = z.string().min(1).max(128);

/**
 * Enforcing call-authorization request (Phase 12R-8). Unlike the preview, this
 * COMMITS side effects (reservation + counters) on ALLOW. `callKey` is the
 * caller's idempotency key for the attempt.
 */
export const AuthorizeCallDto = z
  .object({
    callKey,
    destination: z.string().min(1).max(32),
    estimatedCostMicros: micros.optional(),
  })
  .strict();
export type AuthorizeCallInputDto = z.infer<typeof AuthorizeCallDto>;

/** Report a call's completion so its hold is settled to the actual cost + resources released. */
export const CompleteCallDto = z.object({ callKey, actualCostMicros: micros }).strict();
export type CompleteCallInputDto = z.infer<typeof CompleteCallDto>;

/** Report a call that was never placed / failed so its hold + resources are released. */
export const AbandonCallDto = z.object({ callKey }).strict();
export type AbandonCallInputDto = z.infer<typeof AbandonCallDto>;
