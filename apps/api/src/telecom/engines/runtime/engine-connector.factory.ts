import { EngineConnector, NullEngineConnector } from "./engine-connector";
import { EngineHttpTransport } from "./engine-http-transport";
import { KamailioJsonRpcConnector } from "./kamailio.connector";
import { TelecomCredentialService } from "../../secrets/telecom-credential.service";

/**
 * Selects the wired engine connector (Phase 12M-3). Default — and anything other
 * than an explicit opt-in — is the honest `NullEngineConnector` (no egress). A
 * real connector engages ONLY when the platform sets `ENGINE_CONNECTOR`:
 *
 *   ENGINE_CONNECTOR=kamailio   → KamailioJsonRpcConnector (live health probes)
 *   (unset / anything else)     → NullEngineConnector      (no egress, honest)
 *
 * Even when `kamailio` is selected, nothing is contacted until an engine has a
 * management endpoint (which must pass the SSRF allowlist) AND an ENGINE_API
 * credential — so flipping this flag alone changes no behavior on its own.
 */
export function buildEngineConnector(
  transport: EngineHttpTransport,
  vault: TelecomCredentialService,
  env: NodeJS.ProcessEnv = process.env,
): EngineConnector {
  const selected = (env.ENGINE_CONNECTOR ?? "").trim().toLowerCase();
  if (selected === "kamailio") return new KamailioJsonRpcConnector(transport, vault);
  return new NullEngineConnector();
}
