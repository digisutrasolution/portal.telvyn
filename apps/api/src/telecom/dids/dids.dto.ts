import { z } from "zod";
import { DidStatus } from "@prisma/client";

/**
 * DID DTOs (Phase 12G). Ownership (tenantId) and the canonical `country` are
 * derived server-side — NOT client fields (mass-assignment protection). The
 * raw `number` is normalized to canonical E.164 in the service; format validity
 * is not carrier validity.
 */

// Optional relationship references (validated server-side for scope + existence).
const rel = {
  carrierId: z.string().uuid().optional(),
  sipTrunkId: z.string().uuid().optional(),
  routingProfileId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
};

export const CreateDidDto = z.object({
  number: z.string().min(3).max(32), // raw input; normalized to E.164 server-side
  status: z.nativeEnum(DidStatus).optional(),
  ...rel,
});

export const UpdateDidDto = z
  .object({
    status: z.nativeEnum(DidStatus).optional(),
    // Nullable so a relationship can be explicitly detached.
    carrierId: z.string().uuid().nullable().optional(),
    sipTrunkId: z.string().uuid().nullable().optional(),
    routingProfileId: z.string().uuid().nullable().optional(),
    regionId: z.string().uuid().nullable().optional(),
  })
  .strict(); // number is immutable; unknown keys rejected

export const ListDidsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.nativeEnum(DidStatus).optional(),
  carrierId: z.string().uuid().optional(),
  sipTrunkId: z.string().uuid().optional(),
  routingProfileId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  country: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
  q: z.string().max(32).optional(), // matched against canonical E.164
});

export type CreateDidInput = z.infer<typeof CreateDidDto>;
export type UpdateDidInput = z.infer<typeof UpdateDidDto>;
export type ListDidsInput = z.infer<typeof ListDidsQuery>;
