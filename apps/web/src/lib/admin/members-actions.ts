import { api } from "@/lib/api/client";
import type { Member } from "@/lib/contracts";

/**
 * Read-only members API call (tenant-scoped; `member.read`). Members are
 * strictly tenant-owned — the server derives the tenant from the session and
 * never returns a foreign tenant's members; this client only issues the read.
 * The endpoint returns the full member list (a team is small — no pagination).
 */
export function listMembers(signal?: AbortSignal): Promise<Member[]> {
  return api.get<Member[]>("/v1/members", { signal });
}
