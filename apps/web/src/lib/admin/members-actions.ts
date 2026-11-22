import { api } from "@/lib/api/client";
import type { Member, TenantRole, SetMemberRoles } from "@/lib/contracts";

/**
 * Members API calls (tenant-scoped). Members are strictly tenant-owned — the
 * server derives the tenant from the session and never returns or mutates a
 * foreign tenant's members; this client only shapes the request. A team is small,
 * so lists return the full set (no pagination).
 */

/** The current tenant's members (`member.read`). */
export function listMembers(signal?: AbortSignal): Promise<Member[]> {
  return api.get<Member[]>("/v1/members", { signal });
}

/** Roles assignable in the current tenant — system + custom (`role.read`). Populates the member role picker. */
export function listRoles(signal?: AbortSignal): Promise<TenantRole[]> {
  return api.get<TenantRole[]>("/v1/roles", { signal });
}

/**
 * Replace a membership's roles (`member.manage`). `roleIds` is the complete set
 * (replace semantics; empty removes all). Returns the full, updated member list.
 * 404 if the membership is foreign/removed; 409 if any role is invalid for the tenant.
 */
export function setMemberRoles(membershipId: string, roleIds: string[]): Promise<Member[]> {
  const body: SetMemberRoles = { roleIds };
  return api.put<Member[]>(`/v1/members/${membershipId}/roles`, body);
}
