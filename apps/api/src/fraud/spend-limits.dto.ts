import { z } from "zod";
import { Currency, SpendLimitPeriod } from "@prisma/client";

/**
 * Spend-limit DTOs (Phase 12R-2a) — DECLARATIVE fraud-policy config only. Nothing
 * reads or enforces these yet. `amountMicros` is an INTEGER in millionths of a
 * currency unit — no floating point. Ownership (tenantId) is server-derived.
 */

// Absurd upper bound that keeps Number(amountMicros) JSON-safe (< 2^53):
// 1e15 micros = 1,000,000,000 currency units.
const MAX_AMOUNT_MICROS = 1_000_000_000_000_000;

export const CreateSpendLimitDto = z
  .object({
    period: z.nativeEnum(SpendLimitPeriod),
    amountMicros: z.number().int().min(0).max(MAX_AMOUNT_MICROS), // int rejects NaN/Infinity/floats
    currency: z.nativeEnum(Currency).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const UpdateSpendLimitDto = z
  .object({
    // `period` is the business key — immutable; change it by deleting + recreating.
    amountMicros: z.number().int().min(0).max(MAX_AMOUNT_MICROS).optional(),
    currency: z.nativeEnum(Currency).optional(),
    enabled: z.boolean().optional(),
    expectedVersion: z.number().int().min(0).optional(), // optimistic concurrency
  })
  .strict();

/**
 * Query booleans arrive as strings; `z.coerce.boolean()` would turn "false" into
 * true (a silent inversion). Parse the literal strings explicitly.
 */
const queryBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

export const ListSpendLimitsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  period: z.nativeEnum(SpendLimitPeriod).optional(),
  enabled: queryBoolean.optional(),
});

export type CreateSpendLimitInput = z.infer<typeof CreateSpendLimitDto>;
export type UpdateSpendLimitInput = z.infer<typeof UpdateSpendLimitDto>;
export type ListSpendLimitsInput = z.infer<typeof ListSpendLimitsQuery>;
