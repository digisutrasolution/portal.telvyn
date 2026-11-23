import { z } from "zod";

/**
 * Kill-switch DTOs (Phase 12R-3). A toggle carries an optional human-readable
 * reason (bounded; never secrets/PII).
 */
export const ToggleKillSwitchDto = z
  .object({
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

export type ToggleKillSwitchInput = z.infer<typeof ToggleKillSwitchDto>;
