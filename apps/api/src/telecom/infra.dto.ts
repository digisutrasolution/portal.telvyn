import { z } from "zod";
import {
  TelecomEngineType,
  TelecomEnvironment,
  TelecomStatus,
  EngineCapabilityKey,
  EngineResourceKind,
} from "@prisma/client";
import { isSafeEngineEndpoint } from "./engines/runtime/engine-endpoint";

/**
 * Zod DTOs for platform telecom infrastructure (Phase 12D): Region, Engine
 * (+capabilities), Node. Boundary validation for every mutation. `z.nativeEnum`
 * infers the real Prisma enum type so service inputs are type-safe. None of
 * these resources hold secrets (credentials live in the vault, ADR-0009).
 */

const iso2 = z.string().length(2).regex(/^[A-Z]{2}$/, "ISO-3166-1 alpha-2, uppercase");

// ---- Region ----
export const CreateRegionDto = z.object({
  code: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, "lowercase kebab code"),
  name: z.string().min(1).max(120),
  country: iso2,
  timezone: z.string().min(1).max(64), // IANA
  providerRegion: z.string().max(120).optional(),
  failoverRegionId: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
});
export const UpdateRegionDto = CreateRegionDto.partial().omit({ code: true });
export type CreateRegionInput = z.infer<typeof CreateRegionDto>;
export type UpdateRegionInput = z.infer<typeof UpdateRegionDto>;

// ---- Engine ----
export const CreateEngineDto = z.object({
  name: z.string().min(1).max(120),
  type: z.nativeEnum(TelecomEngineType),
  provider: z.string().max(120).optional(),
  version: z.string().max(60).optional(),
  // Management endpoint (NOT a secret). SSRF-guarded: must be an http(s) URL to a
  // public host — no localhost/private/link-local/metadata targets (Phase 12L).
  endpoint: z
    .string()
    .max(255)
    .refine(isSafeEngineEndpoint, "endpoint must be an http(s) URL to a public host (no private/loopback/metadata targets)")
    .optional(),
  environment: z.nativeEnum(TelecomEnvironment).optional(),
  regionId: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
});
export const UpdateEngineDto = CreateEngineDto.partial().omit({ type: true });
export const SetEngineCapabilitiesDto = z.object({
  capabilities: z.array(z.nativeEnum(EngineCapabilityKey)).max(64),
});
export type CreateEngineInput = z.infer<typeof CreateEngineDto>;
export type UpdateEngineInput = z.infer<typeof UpdateEngineDto>;
export type SetEngineCapabilitiesInput = z.infer<typeof SetEngineCapabilitiesDto>;

// ---- Engine resource assignment (Phase 12N) ----
// `resourceId` is validated against the table implied by `kind`; `tenantId` is
// NEVER client-supplied — it is derived server-side from the resource's owner.
export const AssignEngineResourceDto = z
  .object({
    kind: z.nativeEnum(EngineResourceKind),
    resourceId: z.string().uuid(),
    enabled: z.boolean().optional(),
  })
  .strict();
export const UpdateEngineAssignmentDto = z.object({ enabled: z.boolean() }).strict();
export type AssignEngineResourceInput = z.infer<typeof AssignEngineResourceDto>;
export type UpdateEngineAssignmentInput = z.infer<typeof UpdateEngineAssignmentDto>;

// ---- Node ----
export const CreateNodeDto = z.object({
  name: z.string().min(1).max(120),
  engineId: z.string().uuid(),
  regionId: z.string().uuid().optional(),
  zone: z.string().max(80).optional(),
  environment: z.nativeEnum(TelecomEnvironment).optional(),
  hostRef: z.string().max(255).optional(), // address reference, NOT a secret
  status: z.nativeEnum(TelecomStatus).optional(),
  version: z.string().max(60).optional(),
  maxCps: z.number().int().min(0).max(1_000_000).optional(),
  maxConcurrentCalls: z.number().int().min(0).max(10_000_000).optional(),
});
export const UpdateNodeDto = CreateNodeDto.partial().omit({ engineId: true });
export type CreateNodeInput = z.infer<typeof CreateNodeDto>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeDto>;

// Attach/rotate a node-agent mTLS credential (ADR-0020). The node's PUBLIC client
// certificate is submitted; the private key stays on the node and is never sent.
// The server derives the SHA-256 fingerprint (stored as the credential hint) and
// vaults the cert PEM.
export const AttachNodeCredentialDto = z.object({
  certificate: z.string().min(1).max(16384),
  label: z.string().min(1).max(120).optional(),
});
export type AttachNodeCredentialInput = z.infer<typeof AttachNodeCredentialDto>;
