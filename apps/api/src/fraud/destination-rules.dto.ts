import { z } from "zod";
import { DestinationAction, DestinationMatchType, DestinationRiskClass } from "@prisma/client";

/**
 * Geo/destination-rule DTOs (Phase 12R-2c) — DECLARATIVE fraud-policy config
 * only. Nothing evaluates or enforces these yet. A rule matches by COUNTRY
 * (ISO-3166-1 alpha-2) or by dial PREFIX (E.164 prefix) and carries an ALLOW/DENY
 * action + optional risk class. Ownership (tenantId) is server-derived.
 */

const COUNTRY_RE = /^[A-Z]{2}$/;
const PREFIX_RE = /^\+?[0-9]{1,15}$/;

function matchValueValid(matchType: DestinationMatchType, raw: string): boolean {
  if (matchType === DestinationMatchType.COUNTRY) return COUNTRY_RE.test(raw.toUpperCase());
  if (matchType === DestinationMatchType.PREFIX) return PREFIX_RE.test(raw);
  return false;
}

/** Canonical stored form: COUNTRY → uppercase; PREFIX → digits (no leading +). */
export function normalizeMatchValue(matchType: DestinationMatchType, raw: string): string {
  if (matchType === DestinationMatchType.COUNTRY) return raw.toUpperCase();
  return raw.replace(/^\+/, "");
}

export const CreateDestinationRuleDto = z
  .object({
    matchType: z.nativeEnum(DestinationMatchType),
    matchValue: z.string().min(1).max(20),
    action: z.nativeEnum(DestinationAction),
    riskClass: z.nativeEnum(DestinationRiskClass).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((r) => matchValueValid(r.matchType, r.matchValue), {
    message: "matchValue must be an ISO-3166-1 alpha-2 country (COUNTRY) or a dial prefix of up to 15 digits (PREFIX)",
    path: ["matchValue"],
  });

export const UpdateDestinationRuleDto = z
  .object({
    // matchType + matchValue are the business key — immutable; change them by
    // deleting + recreating.
    action: z.nativeEnum(DestinationAction).optional(),
    riskClass: z.nativeEnum(DestinationRiskClass).optional(),
    enabled: z.boolean().optional(),
    expectedVersion: z.number().int().min(0).optional(), // optimistic concurrency
  })
  .strict();

const queryBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

export const ListDestinationRulesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  matchType: z.nativeEnum(DestinationMatchType).optional(),
  action: z.nativeEnum(DestinationAction).optional(),
  riskClass: z.nativeEnum(DestinationRiskClass).optional(),
  enabled: queryBoolean.optional(),
});

export type CreateDestinationRuleInput = z.infer<typeof CreateDestinationRuleDto>;
export type UpdateDestinationRuleInput = z.infer<typeof UpdateDestinationRuleDto>;
export type ListDestinationRulesInput = z.infer<typeof ListDestinationRulesQuery>;
