/**
 * Phase 12M-3 — connector selection + transport safety floor.
 * Default (and any non-opt-in value) MUST be the honest NullEngineConnector.
 */
import { describe, expect, it, vi } from "vitest";
import { buildEngineConnector } from "./engine-connector.factory";
import { KamailioJsonRpcConnector } from "./kamailio.connector";
import { NullEngineConnector } from "./engine-connector";
import { NodeHttpsEngineTransport, type EngineHttpTransport } from "./engine-http-transport";
import type { TelecomCredentialService } from "../../secrets/telecom-credential.service";

const transport = { postJson: vi.fn() } as unknown as EngineHttpTransport;
const vault = { revealForAdapter: vi.fn() } as unknown as TelecomCredentialService;

describe("buildEngineConnector — env-gated, default off", () => {
  it("defaults to NullEngineConnector when ENGINE_CONNECTOR is unset", () => {
    const c = buildEngineConnector(transport, vault, {});
    expect(c).toBeInstanceOf(NullEngineConnector);
    expect(c.kind).toBe("null");
  });

  it("engages the Kamailio connector only on ENGINE_CONNECTOR=kamailio (case-insensitive)", () => {
    expect(buildEngineConnector(transport, vault, { ENGINE_CONNECTOR: "kamailio" })).toBeInstanceOf(KamailioJsonRpcConnector);
    expect(buildEngineConnector(transport, vault, { ENGINE_CONNECTOR: "KAMAILIO" })).toBeInstanceOf(KamailioJsonRpcConnector);
  });

  it("falls back to Null for any unrecognized value (fail-safe)", () => {
    expect(buildEngineConnector(transport, vault, { ENGINE_CONNECTOR: "freeswitch" })).toBeInstanceOf(NullEngineConnector);
    expect(buildEngineConnector(transport, vault, { ENGINE_CONNECTOR: "" })).toBeInstanceOf(NullEngineConnector);
  });
});

describe("NodeHttpsEngineTransport — refuses plaintext (mTLS required)", () => {
  it("rejects a non-https URL before any network activity", async () => {
    const t = new NodeHttpsEngineTransport();
    await expect(
      t.postJson({
        url: "http://8.8.8.8:8443/",
        body: { jsonrpc: "2.0", method: "core.version" },
        mtls: { cert: "x", key: "y" },
        connectTimeoutMs: 1000,
        requestTimeoutMs: 1000,
        correlationId: "c",
      }),
    ).rejects.toThrow(/https/);
  });
});
