import { z } from "zod";
import { Codec, SipAuthMode, SipTransport, SipTrunkDirection, TelecomStatus } from "@prisma/client";

/**
 * SIP trunk DTOs (Phase 12F) — CONTROL-PLANE CONFIGURATION ONLY. Ownership
 * (tenantId) is derived server-side and is NOT a field here (mass-assignment
 * protection). Endpoint values are validated as SSRF-hostile input: no control
 * characters, no CRLF/header injection, no arbitrary schemes. Nothing here
 * establishes live connectivity.
 */

// ---- endpoint validators (treat host/URI as attacker-controlled) ----
/** True if the string contains any C0/C1 control character (incl. CR/LF/TAB/NUL) or DEL. */
const hasControlChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};
const isIPv4 = (v: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  return !!m && m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
};
const isIPv6 = (v: string) => /^[0-9a-fA-F:]{2,45}$/.test(v) && v.includes(":");
const isHostname = (v: string) =>
  v.length <= 253 && /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/.test(v);

const hostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((v) => !hasControlChar(v), "control characters are not allowed")
  .refine((v) => !/\s/.test(v), "whitespace is not allowed")
  .refine((v) => isIPv4(v) || isIPv6(v) || isHostname(v), "must be a valid hostname or IP address");

const sipUriSchema = z
  .string()
  .max(512)
  .refine((v) => /^sips?:/i.test(v), "must be a sip: or sips: URI")
  .refine((v) => !hasControlChar(v) && !/\s/.test(v), "control characters / whitespace are not allowed");

const ipOrCidr = z.string().refine((v) => {
  const [addr, mask] = v.split("/");
  if (mask !== undefined) {
    const m = Number(mask);
    if (!Number.isInteger(m) || m < 0 || m > 128) return false;
  }
  return isIPv4(addr) || isIPv6(addr);
}, "must be a valid IPv4/IPv6 address or CIDR");

// ---- inline SIP credential (secret goes straight to the vault; type is forced SIP_PASSWORD) ----
const InlineSipCredential = z.object({
  label: z.string().min(1).max(120),
  hint: z.string().max(120).optional(),
  secret: z.string().min(1).max(4096),
});

const base = {
  name: z.string().min(1).max(120),
  carrierId: z.string().uuid(),
  direction: z.nativeEnum(SipTrunkDirection).optional(),
  sipUri: sipUriSchema.optional(),
  host: hostSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  transport: z.nativeEnum(SipTransport).optional(),
  tls: z.boolean().optional(),
  authMode: z.nativeEnum(SipAuthMode).optional(), // IP | CREDENTIALS (12B) — NONE/REGISTRATION are future
  allowedIps: z.array(ipOrCidr).max(64).optional(),
  codecs: z.array(z.nativeEnum(Codec)).max(32).optional(),
  srtp: z.boolean().optional(),
  dtmfMode: z.enum(["rfc2833", "info", "inband"]).optional(), // declarative enum, not a free string
  maxCps: z.number().int().min(0).max(1_000_000).optional(),
  maxConcurrentCalls: z.number().int().min(0).max(10_000_000).optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  credentialId: z.string().uuid().optional(),
  credential: InlineSipCredential.optional(),
};

const notBoth = (d: { credentialId?: string; credential?: unknown }) => !(d.credentialId && d.credential);
const credMsg = { message: "Provide credentialId or credential, not both", path: ["credential"] };

export const CreateSipTrunkDto = z.object(base).refine(notBoth, credMsg);
export const UpdateSipTrunkDto = z.object({ ...base, carrierId: base.carrierId.optional() }).partial().refine(notBoth, credMsg);

export const ListSipTrunksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  direction: z.nativeEnum(SipTrunkDirection).optional(),
  transport: z.nativeEnum(SipTransport).optional(),
  carrierId: z.string().uuid().optional(),
  q: z.string().max(120).optional(),
});

export type CreateSipTrunkInput = z.infer<typeof CreateSipTrunkDto>;
export type UpdateSipTrunkInput = z.infer<typeof UpdateSipTrunkDto>;
export type ListSipTrunksInput = z.infer<typeof ListSipTrunksQuery>;
