import { z } from "zod";
import { FraudEventSeverity, FraudEventType } from "@prisma/client";

/**
 * Query for GET /v1/fraud/events — cursor pagination (UUIDv7) + optional
 * type/severity filters. Read-only; the tenant scope is server-derived, never a
 * client field.
 */
export const ListFraudEventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  type: z.nativeEnum(FraudEventType).optional(),
  severity: z.nativeEnum(FraudEventSeverity).optional(),
});
export type ListFraudEventsInput = z.infer<typeof ListFraudEventsQuery>;
