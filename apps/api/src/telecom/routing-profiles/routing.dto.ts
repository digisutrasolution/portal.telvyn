import { z } from "zod";
import {
  RoutingDestinationType,
  RoutingDirection,
  RoutingFailoverCondition,
  RoutingSelectionStrategy,
  TelecomStatus,
} from "@prisma/client";
import { normalizeE164 } from "../dids/e164";

/**
 * Routing profile + policy + rule DTOs (Phase 12H/12I) — DECLARATIVE CONFIG ONLY.
 * Nothing here is executed. Ownership (tenantId) is server-derived. Webhook
 * destinations are SSRF-validated as config and are NEVER called.
 */

const hasControlChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};
const isIPv4 = (v: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((o) => Number(o) <= 255);
const isPrivateOrLocalHost = (host: string): boolean => {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isIPv4(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
  }
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
};
function isValidWebhook(v: string): boolean {
  if (hasControlChar(v) || /\s/.test(v) || v.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && !isPrivateOrLocalHost(u.hostname);
}

/** Validate a destination VALUE against its type. Returns an error message or null. */
export function validateDestinationValue(type: RoutingDestinationType, value: string): string | null {
  switch (type) {
    case RoutingDestinationType.PHONE_NUMBER:
      return normalizeE164(value).ok ? null : "destination must be a valid E.164 number";
    case RoutingDestinationType.EXTENSION:
      return /^[0-9]{1,10}$/.test(value) ? null : "extension must be 1-10 digits";
    case RoutingDestinationType.SIP_TRUNK:
      return /^[0-9a-fA-F-]{36}$/.test(value) ? null : "destination must be a SIP trunk id (uuid)";
    case RoutingDestinationType.VOICEMAIL:
      return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? null : "voicemail target must be a simple identifier";
    case RoutingDestinationType.WEBHOOK:
      return isValidWebhook(value) ? null : "webhook must be an https URL to a public host (no control chars)";
    default:
      return "unknown destination type";
  }
}

const scheduleSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
  })
  .refine((s) => s.startMinute < s.endMinute, { message: "startMinute must be before endMinute" });

const RuleInput = z
  .object({
    destinationType: z.nativeEnum(RoutingDestinationType),
    destination: z.string().min(1).max(2048),
    priority: z.number().int().min(0).max(100_000).optional(),
    weight: z.number().int().min(1).max(1000).optional(),
    enabled: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(600).optional(),
    retryCount: z.number().int().min(0).max(10).optional(),
    carrierId: z.string().uuid().optional(),
    failoverDestination: z.string().min(1).max(2048).optional(),
    failoverDestinationType: z.nativeEnum(RoutingDestinationType).optional(),
    failoverAfterSeconds: z.number().int().min(1).max(600).optional(),
    schedule: scheduleSchema.optional(),
  })
  .superRefine((r, ctx) => {
    const primary = validateDestinationValue(r.destinationType, r.destination);
    if (primary) ctx.addIssue({ code: z.ZodIssueCode.custom, message: primary, path: ["destination"] });
    // Typed failover: if a failover destination is given, its type is required and validated.
    if (r.failoverDestination !== undefined) {
      if (r.failoverDestinationType === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "failoverDestinationType is required with failoverDestination", path: ["failoverDestinationType"] });
      } else {
        const fo = validateDestinationValue(r.failoverDestinationType, r.failoverDestination);
        if (fo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: fo, path: ["failoverDestination"] });
      }
    } else if (r.failoverDestinationType !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "failoverDestination is required with failoverDestinationType", path: ["failoverDestination"] });
    }
  });

const policyFields = {
  selectionStrategy: z.nativeEnum(RoutingSelectionStrategy).optional(),
  failoverEnabled: z.boolean().optional(),
  failoverConditions: z.array(z.nativeEnum(RoutingFailoverCondition)).max(5).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(), // bounded → loop protection
  overallTimeoutSeconds: z.number().int().min(1).max(3600).optional(),
};

// A failover-enabled policy must declare at least one condition (no silent no-op).
const failoverConsistent = (d: { failoverEnabled?: boolean; failoverConditions?: unknown[] }) =>
  !(d.failoverEnabled === true && (!d.failoverConditions || d.failoverConditions.length === 0));
const failoverMsg = { message: "failoverEnabled requires at least one failoverCondition", path: ["failoverConditions"] };

export const CreateRoutingProfileDto = z
  .object({
    name: z.string().min(1).max(120),
    direction: z.nativeEnum(RoutingDirection).optional(),
    description: z.string().max(500).optional(),
    status: z.nativeEnum(TelecomStatus).optional(),
    ...policyFields,
    rules: z.array(RuleInput).max(100).optional(),
  })
  .refine(failoverConsistent, failoverMsg);

export const UpdateRoutingProfileDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    direction: z.nativeEnum(RoutingDirection).optional(),
    description: z.string().max(500).nullable().optional(),
    status: z.nativeEnum(TelecomStatus).optional(),
    ...policyFields,
    rules: z.array(RuleInput).max(100).optional(), // when present, replaces the rule set
    expectedVersion: z.number().int().min(0).optional(), // optimistic concurrency
  })
  .strict()
  .refine(failoverConsistent, failoverMsg);

export const ListRoutingProfilesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  direction: z.nativeEnum(RoutingDirection).optional(),
  strategy: z.nativeEnum(RoutingSelectionStrategy).optional(),
  q: z.string().max(120).optional(),
});

export type RuleInputType = z.infer<typeof RuleInput>;
export type CreateRoutingProfileInput = z.infer<typeof CreateRoutingProfileDto>;
export type UpdateRoutingProfileInput = z.infer<typeof UpdateRoutingProfileDto>;
export type ListRoutingProfilesInput = z.infer<typeof ListRoutingProfilesQuery>;
