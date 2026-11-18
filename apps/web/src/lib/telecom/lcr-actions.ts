import { api } from "@/lib/api/client";
import type { LcrPolicy, LcrPolicyPage } from "@/lib/contracts";

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
