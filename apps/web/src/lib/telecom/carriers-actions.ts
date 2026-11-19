import { api } from "@/lib/api/client";
import type { Carrier, CarrierPage } from "@/lib/contracts";

/**
 * Read-only carrier API calls (tenant-scoped; `carrier.read`). The server scopes
 * results to the session's own tenant plus system (platform-owned) carriers and
 * never returns a foreign tenant's carriers — this client only shapes the query.
 * Secrets never appear: a carrier carries only a non-secret credential reference.
 */
export interface ListCarriersParams {
  limit?: number;
  cursor?: string;
  status?: Carrier["status"];
  regionId?: string;
  scope?: "all" | "system" | "tenant";
  q?: string;
}

/** One carrier the session may see (own or system); 404 if not found / foreign. */
export function getCarrier(id: string, signal?: AbortSignal): Promise<Carrier> {
  return api.get<Carrier>(`/v1/telecom/carriers/${id}`, { signal });
}

/** Carriers visible to the session (own + system), cursor-paginated. */
export function listCarriers(params: ListCarriersParams = {}, signal?: AbortSignal): Promise<CarrierPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.status) qs.set("status", params.status);
  if (params.regionId) qs.set("regionId", params.regionId);
  if (params.scope) qs.set("scope", params.scope);
  if (params.q) qs.set("q", params.q);
  const query = qs.toString();
  return api.get<CarrierPage>(`/v1/telecom/carriers${query ? `?${query}` : ""}`, { signal });
}
