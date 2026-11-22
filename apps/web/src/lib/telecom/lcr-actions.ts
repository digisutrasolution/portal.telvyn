import { api } from "@/lib/api/client";
import type { LcrPolicy, LcrPolicyPage, CreateLcrPolicy, UpdateLcrPolicy } from "@/lib/contracts";

/**
 * Read-only LCR-policy API calls (tenant-scoped; `routing.read` — LCR is part of
 * the routing domain). Policies are strictly tenant-owned — the server
 * auto-scopes to the session's tenant; this client only shapes the query.
 * Declarative route selection only (never executed, rated or billed).
 */
export interface ListLcrPoliciesParams {
  limit?: number;
  cursor?: string;
  enabled?: boolean;
  strategy?: LcrPolicy["selectionStrategy"];
  q?: string;
}

/** One LCR policy owned by the session's tenant (ordered route candidates); 404 if not found / foreign (IDOR-safe). */
export function getLcrPolicy(id: string, signal?: AbortSignal): Promise<LcrPolicy> {
  return api.get<LcrPolicy>(`/v1/telecom/lcr-policies/${id}`, { signal });
}

/** The tenant's LCR policies (each with its ordered route candidates), paginated. */
export function listLcrPolicies(params: ListLcrPoliciesParams = {}, signal?: AbortSignal): Promise<LcrPolicyPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.enabled !== undefined) qs.set("enabled", String(params.enabled));
  if (params.strategy) qs.set("strategy", params.strategy);
  if (params.q) qs.set("q", params.q);
  const query = qs.toString();
  return api.get<LcrPolicyPage>(`/v1/telecom/lcr-policies${query ? `?${query}` : ""}`, { signal });
}

/** Create an LCR policy (`routing.manage`); ownership is server-derived. Omitting `routes` creates an empty route set. Returns the created policy. */
export function createLcrPolicy(body: CreateLcrPolicy): Promise<LcrPolicy> {
  return api.post<LcrPolicy>("/v1/telecom/lcr-policies", body);
}

/** Partially update an LCR policy (`routing.manage`). Omitting `routes` preserves the route set; `expectedVersion` enables optimistic concurrency. Returns the updated policy; 404 if foreign/removed. */
export function updateLcrPolicy(id: string, body: UpdateLcrPolicy): Promise<LcrPolicy> {
  return api.patch<LcrPolicy>(`/v1/telecom/lcr-policies/${id}`, body);
}

/** Soft-delete an LCR policy (`routing.manage`); 204 No Content. 404 if foreign/removed. */
export function deleteLcrPolicy(id: string): Promise<void> {
  return api.delete<void>(`/v1/telecom/lcr-policies/${id}`);
}
