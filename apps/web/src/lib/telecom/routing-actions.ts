import { api } from "@/lib/api/client";
import type { RoutingProfile, RoutingProfilePage } from "@/lib/contracts";

/**
 * Read-only routing-profile API calls (tenant-scoped; `routing.read`). Profiles
 * are strictly tenant-owned — the server auto-scopes to the session's tenant;
 * this client only shapes the query. Declarative config only (never executed).
 */
export interface ListRoutingProfilesParams {
  limit?: number;
  cursor?: string;
  status?: RoutingProfile["status"];
  direction?: RoutingProfile["direction"];
  strategy?: RoutingProfile["policy"]["selectionStrategy"];
  q?: string;
}

/** One routing profile owned by the session's tenant (full policy + ordered rules); 404 if not found / foreign (IDOR-safe). */
export function getRoutingProfile(id: string, signal?: AbortSignal): Promise<RoutingProfile> {
  return api.get<RoutingProfile>(`/v1/telecom/routing-profiles/${id}`, { signal });
}

/** The tenant's routing profiles (each with its policy + ordered rules), paginated. */
export function listRoutingProfiles(params: ListRoutingProfilesParams = {}, signal?: AbortSignal): Promise<RoutingProfilePage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.status) qs.set("status", params.status);
  if (params.direction) qs.set("direction", params.direction);
  if (params.strategy) qs.set("strategy", params.strategy);
  if (params.q) qs.set("q", params.q);
  const query = qs.toString();
  return api.get<RoutingProfilePage>(`/v1/telecom/routing-profiles${query ? `?${query}` : ""}`, { signal });
}
