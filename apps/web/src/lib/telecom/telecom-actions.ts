import { api } from "@/lib/api/client";
import type { Engine, EngineHealthReport, EngineStatus, HealthEventPage, ConfigVersionPage, Node, NodeHealthReport, Region, SyncOutcome } from "@/lib/contracts";

/**
 * Read-only telecom (NOC) API calls. Platform-scoped on the server
 * (PlatformGuard + telecom.read); the frontend also gates the route/nav on the
 * platform tenant (ADR-0017/0018), but the API remains the authority.
 */

/** Platform list of telecom engines with honest health. */
export function listEngines(signal?: AbortSignal): Promise<Engine[]> {
  return api.get<Engine[]>("/v1/telecom/engines", { signal });
}

/** One engine by id (404 if not found). */
export function getEngine(id: string, signal?: AbortSignal): Promise<Engine> {
  return api.get<Engine>(`/v1/telecom/engines/${id}`, { signal });
}

/** Normalized engine status: health + connection + config-version posture (read-only). */
export function getEngineStatus(id: string, signal?: AbortSignal): Promise<EngineStatus> {
  return api.get<EngineStatus>(`/v1/telecom/engines/${id}/status`, { signal });
}

/** The engine's health-event history (newest first), cursor-paginated (`telecom.health.read`). */
export function listEngineHealthEvents(id: string, params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal): Promise<HealthEventPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const query = qs.toString();
  return api.get<HealthEventPage>(`/v1/telecom/engines/${id}/health-events${query ? `?${query}` : ""}`, { signal });
}

/** The engine's config-version history (newest first), cursor-paginated (`telecom.health.read`); secret-free snapshots. */
export function listEngineConfigVersions(id: string, params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal): Promise<ConfigVersionPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const query = qs.toString();
  return api.get<ConfigVersionPage>(`/v1/telecom/engines/${id}/config-versions${query ? `?${query}` : ""}`, { signal });
}

/** Platform list of telecom regions. */
export function listRegions(signal?: AbortSignal): Promise<Region[]> {
  return api.get<Region[]>("/v1/telecom/regions", { signal });
}

/** Platform list of telecom nodes with heartbeat health. */
export function listNodes(signal?: AbortSignal): Promise<Node[]> {
  return api.get<Node[]>("/v1/telecom/nodes", { signal });
}

/** Operator-driven node health probe (`telecom.health.read`); honest posture, records a transition. Non-destructive. */
export function checkNodeHealth(id: string): Promise<NodeHealthReport> {
  return api.post<NodeHealthReport>(`/v1/telecom/nodes/${id}/health-check`);
}

/** The node's health-event history (newest first), cursor-paginated (`telecom.health.read`). Same shape as the engine history. */
export function listNodeHealthEvents(id: string, params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal): Promise<HealthEventPage> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const query = qs.toString();
  return api.get<HealthEventPage>(`/v1/telecom/nodes/${id}/health-events${query ? `?${query}` : ""}`, { signal });
}

/**
 * Attach or rotate the node's NODE_AGENT mTLS credential (`telecom.manage`). The
 * `certificate` is the node's PUBLIC client cert (PEM) — never a private key; the
 * server derives the fingerprint and vaults the cert. Returns the updated node.
 */
export function attachNodeCredential(id: string, body: { certificate: string; label?: string }): Promise<Node> {
  return api.post<Node>(`/v1/telecom/nodes/${id}/credential`, body);
}

/** Detach the node's NODE_AGENT credential (`telecom.manage`); 204 No Content. */
export function detachNodeCredential(id: string): Promise<void> {
  return api.delete<void>(`/v1/telecom/nodes/${id}/credential`);
}

// ---- mutating engine actions (platform; state-changing, never auto-retried) ----

/** Actively probe engine health (telecom.health.read). Non-destructive. */
export function checkEngineHealth(id: string): Promise<EngineHealthReport> {
  return api.post<EngineHealthReport>(`/v1/telecom/engines/${id}/health-check`);
}

/** Sync control-plane config to the engine (telecom.manage). 501 with a stub adapter. */
export function syncEngine(id: string): Promise<SyncOutcome> {
  return api.post<SyncOutcome>(`/v1/telecom/engines/${id}/sync`);
}

/** Roll back to the previous desired config version (telecom.manage). */
export function rollbackEngine(id: string): Promise<SyncOutcome> {
  return api.post<SyncOutcome>(`/v1/telecom/engines/${id}/sync/rollback`);
}
