import { api } from "@/lib/api/client";
import type { Did, DidPage } from "@/lib/contracts";

/**
 * Read-only DID API calls (tenant-scoped; `did.read`). DIDs are strictly
 * tenant-owned — the server auto-scopes to the session's tenant and never
 * returns the platform inventory pool or another tenant's numbers; this client
 * only shapes the query. Responses carry reference ids only (no embedded objects).
 */
export interface ListDidsParams {
  limit?: number;
  cursor?: string;
  status?: Did["status"];
  carrierId?: string;
  sipTrunkId?: string;
  routingProfileId?: string;
  regionId?: string;
  country?: string;
  q?: string;
}

/** One DID owned by the session's tenant; 404 if not found / foreign / pool (IDOR-safe). */
export function getDid(id: string, signal?: AbortSignal): Promise<Did> {
  return api.get<Did>(`/v1/telecom/dids/${id}`, { signal });
}

/** The tenant's DIDs, cursor-paginated. */
export function listDids(params: ListDidsParams = {}, signal?: AbortSignal): Promise<DidPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.status) qs.set("status", params.status);
  if (params.carrierId) qs.set("carrierId", params.carrierId);
  if (params.sipTrunkId) qs.set("sipTrunkId", params.sipTrunkId);
  if (params.routingProfileId) qs.set("routingProfileId", params.routingProfileId);
  if (params.regionId) qs.set("regionId", params.regionId);
  if (params.country) qs.set("country", params.country);
  if (params.q) qs.set("q", params.q);
  const query = qs.toString();
  return api.get<DidPage>(`/v1/telecom/dids${query ? `?${query}` : ""}`, { signal });
}
