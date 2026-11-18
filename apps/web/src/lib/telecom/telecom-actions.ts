import { api } from "@/lib/api/client";
import type { Engine } from "@/lib/contracts";

/**
 * Read-only telecom (NOC) API calls. Platform-scoped on the server
 * (PlatformGuard + telecom.read); the frontend also gates the route/nav on the
 * platform tenant (ADR-0017/0018), but the API remains the authority.
 */

/** Platform list of telecom engines with honest health. */
export function listEngines(signal?: AbortSignal): Promise<Engine[]> {
  return api.get<Engine[]>("/v1/telecom/engines", { signal });
}
