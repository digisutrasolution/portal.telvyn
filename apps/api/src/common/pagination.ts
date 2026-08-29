import { z } from "zod";

/**
 * Cursor pagination over UUIDv7 primary keys. Because UUIDv7 is time-ordered,
 * `orderBy id desc` is a deterministic newest-first order and the id doubles as
 * an opaque cursor — no separate sort column needed. Lists are always bounded.
 */
export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});
export type PaginationInput = z.infer<typeof PaginationQuery>;

/** Prisma args for a cursor page (fetch limit+1 to detect a next page). */
export function cursorArgs(limit: number, cursor?: string) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "desc" as const },
  };
}

/** Split a fetched (limit+1) row set into a page + nextCursor. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null };
}
