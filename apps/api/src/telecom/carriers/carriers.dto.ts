import { z } from "zod";
import { CarrierType, Codec, TelecomStatus, TelecomCredentialType } from "@prisma/client";

/**
 * Carrier DTOs (Phase 12E). Scope (system vs tenant) and ownership are derived
 * from the authenticated context — NEVER accepted from the client, so there is
 * no `tenantId`/`scope`/`ownerId` field here (mass-assignment protection).
 * Secret material is only ever supplied inline for immediate vaulting; it is
 * never stored on or returned from the carrier.
 */

const iso2 = z.string().length(2).regex(/^[A-Z]{2}$/, "ISO-3166-1 alpha-2, uppercase");

// Inline credential to create + attach (secret goes straight to the vault).
const InlineCredential = z.object({
  type: z.nativeEnum(TelecomCredentialType),
  label: z.string().min(1).max(120),
  hint: z.string().max(120).optional(),
  secret: z.string().min(1).max(4096),
});

const carrierBase = {
  name: z.string().min(1).max(120),
  type: z.nativeEnum(CarrierType).optional(),
  country: iso2.optional(),
  regionId: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  priority: z.number().int().min(0).max(100_000).optional(),
  codecs: z.array(z.nativeEnum(Codec)).max(32).optional(),
  maxCps: z.number().int().min(0).max(1_000_000).optional(),
  maxConcurrentCalls: z.number().int().min(0).max(10_000_000).optional(),
  // Attach an existing credential by id OR create one inline — never both.
  credentialId: z.string().uuid().optional(),
  credential: InlineCredential.optional(),
};

const notBothCredentials = (d: { credentialId?: string; credential?: unknown }) => !(d.credentialId && d.credential);
const credentialMsg = { message: "Provide credentialId or credential, not both", path: ["credential"] };

export const CreateCarrierDto = z.object({ ...carrierBase, name: carrierBase.name }).refine(notBothCredentials, credentialMsg);
export const UpdateCarrierDto = z
  .object(carrierBase)
  .partial()
  .refine(notBothCredentials, credentialMsg);

export const ListCarriersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.nativeEnum(TelecomStatus).optional(),
  regionId: z.string().uuid().optional(),
  scope: z.enum(["all", "system", "tenant"]).default("all"),
  q: z.string().max(120).optional(),
});

export type CreateCarrierInput = z.infer<typeof CreateCarrierDto>;
export type UpdateCarrierInput = z.infer<typeof UpdateCarrierDto>;
export type ListCarriersInput = z.infer<typeof ListCarriersQuery>;
