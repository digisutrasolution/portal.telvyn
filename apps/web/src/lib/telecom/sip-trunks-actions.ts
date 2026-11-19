import { api } from "@/lib/api/client";
import type { SipTrunk, SipTrunkPage } from "@/lib/contracts";

/**
 * Read-only SIP trunk API calls (tenant-scoped; `sip_trunk.read`). Trunks are
 * strictly tenant-owned — the server auto-scopes to the session's tenant and
 * never returns a foreign tenant's trunks; this client only shapes the query.
 * Control-plane config only (no live connectivity); secrets never appear.
 */
export interface ListSipTrunksParams {
  limit?: number;
  cursor?: string;
  status?: SipTrunk["status"];
  direction?: SipTrunk["direction"];
  transport?: SipTrunk["transport"];
  carrierId?: string;
  q?: string;
}

/** One SIP trunk owned by the session's tenant; 404 if not found / foreign (IDOR-safe). */
export function getSipTrunk(id: string, signal?: AbortSignal): Promise<SipTrunk> {
  return api.get<SipTrunk>(`/v1/telecom/sip-trunks/${id}`, { signal });
}

/** The tenant's SIP trunks, cursor-paginated. */
export function listSipTrunks(params: ListSipTrunksParams = {}, signal?: AbortSignal): Promise<SipTrunkPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.status) qs.set("status", params.status);
  if (params.direction) qs.set("direction", params.direction);
  if (params.transport) qs.set("transport", params.transport);
  if (params.carrierId) qs.set("carrierId", params.carrierId);
  if (params.q) qs.set("q", params.q);
  const query = qs.toString();
  return api.get<SipTrunkPage>(`/v1/telecom/sip-trunks${query ? `?${query}` : ""}`, { signal });
}
