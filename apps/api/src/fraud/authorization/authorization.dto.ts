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
