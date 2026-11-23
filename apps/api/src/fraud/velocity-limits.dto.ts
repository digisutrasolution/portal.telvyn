import { z } from "zod";
import { VelocityMetric } from "@prisma/client";

/**
 * Velocity-limit DTOs (Phase 12R-2b) — DECLARATIVE fraud-policy config only.
 * Nothing counts or enforces these yet. `limit` is an integer count (calls per
 * window, or the concurrent-call cap). Ownership (tenantId) is server-derived.
 */

// Absurd upper bound for a call count.
const MAX_LIMIT = 10_000_000;

export const CreateVelocityLimitDto = z
  .object({
    metric: z.nativeEnum(VelocityMetric),
    limit: z.number().int().min(0).max(MAX_LIMIT), // int rejects NaN/Infinity/floats
    enabled: z.boolean().optional(),
  })
  .strict();

export const UpdateVelocityLimitDto = z
  .object({
    // `metric` is the business key — immutable; change it by deleting + recreating.
    limit: z.number().int().min(0).max(MAX_LIMIT).optional(),
    enabled: z.boolean().optional(),
    expectedVersion: z.number().int().min(0).optional(), // optimistic concurrency
  })
  .strict();

const queryBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

export const ListVelocityLimitsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25), // page size
  cursor: z.string().uuid().optional(),
  metric: z.nativeEnum(VelocityMetric).optional(),
  enabled: queryBoolean.optional(),
});

export type CreateVelocityLimitInput = z.infer<typeof CreateVelocityLimitDto>;
export type UpdateVelocityLimitInput = z.infer<typeof UpdateVelocityLimitDto>;
export type ListVelocityLimitsInput = z.infer<typeof ListVelocityLimitsQuery>;
