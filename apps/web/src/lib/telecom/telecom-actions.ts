import { api } from "@/lib/api/client";
import type { Engine, EngineStatus } from "@/lib/contracts";

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
