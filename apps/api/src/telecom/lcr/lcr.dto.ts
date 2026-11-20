import { z } from "zod";
import { Currency, LcrSelectionStrategy } from "@prisma/client";

/**
 * LCR policy + route DTOs (Phase 12J) — DECLARATIVE ROUTE SELECTION CONFIG ONLY.
 * NOTHING is executed and NO customer is charged (route-selection cost, not
 * rating/billing). Ownership (tenantId) is server-derived. `costMicros` is an
 * INTEGER in millionths of a currency unit — no floating point.
 */

const MAX_COST_MICROS = 1_000_000_000_000; // 1,000,000 currency units/min — absurd upper bound
const iso2 = z.string().length(2).regex(/^[A-Z]{2}$/, "ISO-3166-1 alpha-2, uppercase");
const prefix = z.string().regex(/^\+?[0-9]{1,15}$/, "prefix must be up to 15 digits (optional leading +)");

const RouteInput = z
  .object({
    carrierId: z.string().uuid(),
    sipTrunkId: z.string().uuid().optional(),
    prefix,
    country: iso2.optional(),
    costMicros: z.number().int().min(0).max(MAX_COST_MICROS), // int rejects NaN/Infinity/floats
    currency: z.nativeEnum(Currency),
    priority: z.number().int().min(0).max(100_000).optional(),
    weight: z.number().int().min(1).max(1000).optional(),
    enabled: z.boolean().optional(),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().optional(),
  })
  .refine((r) => !(r.effectiveFrom && r.effectiveTo) || new Date(r.effectiveFrom) < new Date(r.effectiveTo), {
    message: "effectiveFrom must be before effectiveTo",
    path: ["effectiveTo"],
  });

export const CreateLcrPolicyDto = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  selectionStrategy: z.nativeEnum(LcrSelectionStrategy).optional(),
  enabled: z.boolean().optional(),
  routes: z.array(RouteInput).max(500).optional(),
});

export const UpdateLcrPolicyDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    selectionStrategy: z.nativeEnum(LcrSelectionStrategy).optional(),
    enabled: z.boolean().optional(),
    routes: z.array(RouteInput).max(500).optional(), // when present, replaces the route set
    expectedVersion: z.number().int().min(0).optional(), // optimistic concurrency
  })
  .strict();

/**
 * Query booleans arrive as strings. `z.coerce.boolean()` is `Boolean(v)`, so
 * "false" would coerce to `true` — a silent filter inversion. Parse the literal
 * strings explicitly (and pass through a real boolean, for direct callers) so
 * `enabled=false` honestly means false. Any other value is rejected (400).
 */
const queryBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

export const ListLcrPoliciesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  enabled: queryBoolean.optional(),
  strategy: z.nativeEnum(LcrSelectionStrategy).optional(),
  q: z.string().max(120).optional(),
});

export type RouteInputType = z.infer<typeof RouteInput>;
export type CreateLcrPolicyInput = z.infer<typeof CreateLcrPolicyDto>;
export type UpdateLcrPolicyInput = z.infer<typeof UpdateLcrPolicyDto>;
export type ListLcrPoliciesInput = z.infer<typeof ListLcrPoliciesQuery>;
