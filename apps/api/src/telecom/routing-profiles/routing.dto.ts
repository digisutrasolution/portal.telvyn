import { z } from "zod";
import { RoutingDestinationType, RoutingDirection, TelecomStatus } from "@prisma/client";
import { normalizeE164 } from "../dids/e164";

/**
 * Routing profile + rule DTOs (Phase 12H) — DECLARATIVE CONFIGURATION ONLY.
 * Nothing here is executed. Ownership (tenantId) is server-derived, never a
 * client field. Rules are managed embedded in the profile (a `rules` array).
 * Webhook destinations are SSRF-validated as config and are NEVER called in 12H.
 */

const hasControlChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

// ---- destination value validation, per type ----
const isIPv4 = (v: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((o) => Number(o) <= 255);
const isPrivateOrLocalHost = (host: string): boolean => {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isIPv4(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true; // private / loopback / this-host
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a >= 224) return true; // multicast/reserved
  }
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 loopback/link-local/ULA
  return false;
};

/** Validate a webhook URL as an SSRF-hostile CONFIG value (not fetched in 12H). */
function validateWebhook(v: string): boolean {
  if (hasControlChar(v) || /\s/.test(v) || v.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false; // https only
  if (u.username || u.password) return false; // no credentials in URL
  if (isPrivateOrLocalHost(u.hostname)) return false; // block private/loopback/link-local targets
  return true;
}

/** A single declarative destination: the value is validated against its type. */
const RuleInput = z
  .object({
    destinationType: z.nativeEnum(RoutingDestinationType),
    destination: z.string().min(1).max(2048),
    priority: z.number().int().min(0).max(100_000).optional(),
    enabled: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(600).optional(),
    retryCount: z.number().int().min(0).max(10).optional(),
    carrierId: z.string().uuid().optional(),
    failoverDestination: z.string().min(1).max(2048).optional(),
    failoverAfterSeconds: z.number().int().min(1).max(600).optional(),
    schedule: z
      .object({
        timezone: z.string().min(1).max(64), // IANA — validated at runtime in the service
        daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        startMinute: z.number().int().min(0).max(1439), // minutes from local midnight
        endMinute: z.number().int().min(0).max(1439),
      })
      .refine((s) => s.startMinute < s.endMinute, { message: "startMinute must be before endMinute" })
      .optional(),
  })
  .superRefine((r, ctx) => {
    const bad = (m: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: m, path: ["destination"] });
    switch (r.destinationType) {
      case RoutingDestinationType.PHONE_NUMBER:
        if (!normalizeE164(r.destination).ok) bad("destination must be a valid E.164 number");
        break;
      case RoutingDestinationType.EXTENSION:
        if (!/^[0-9]{1,10}$/.test(r.destination)) bad("extension must be 1-10 digits");
        break;
      case RoutingDestinationType.SIP_TRUNK:
        if (!/^[0-9a-fA-F-]{36}$/.test(r.destination)) bad("destination must be a SIP trunk id (uuid)");
        break;
      case RoutingDestinationType.VOICEMAIL:
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(r.destination)) bad("voicemail target must be a simple identifier");
        break;
      case RoutingDestinationType.WEBHOOK:
        if (!validateWebhook(r.destination)) bad("webhook must be an https URL to a public host (no control chars)");
        break;
    }
  });

export const CreateRoutingProfileDto = z.object({
  name: z.string().min(1).max(120),
  direction: z.nativeEnum(RoutingDirection).optional(),
  description: z.string().max(500).optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  rules: z.array(RuleInput).max(100).optional(),
});

export const UpdateRoutingProfileDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    direction: z.nativeEnum(RoutingDirection).optional(),
    description: z.string().max(500).nullable().optional(),
    status: z.nativeEnum(TelecomStatus).optional(),
    rules: z.array(RuleInput).max(100).optional(), // when present, replaces the rule set
  })
  .strict();

export const ListRoutingProfilesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  direction: z.nativeEnum(RoutingDirection).optional(),
  q: z.string().max(120).optional(),
});

export type RuleInputType = z.infer<typeof RuleInput>;
export type CreateRoutingProfileInput = z.infer<typeof CreateRoutingProfileDto>;
export type UpdateRoutingProfileInput = z.infer<typeof UpdateRoutingProfileDto>;
export type ListRoutingProfilesInput = z.infer<typeof ListRoutingProfilesQuery>;
