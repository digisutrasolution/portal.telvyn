/**
 * Phase 12M-3 — KamailioJsonRpcConnector unit tests. The transport (network) and
 * the vault are mocked, so connector LOGIC is proven with zero live egress:
 * honest health mapping, credential handling at the adapter boundary, JSONRPC
 * parsing, and a safe failure vocabulary that never leaks secrets.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HealthStatus, TelecomCredentialType, TelecomEngineType } from "@prisma/client";
import { KamailioJsonRpcConnector } from "./kamailio.connector";
import { connectionProfile } from "./connection-profiles";
import type { EngineHttpTransport } from "./engine-http-transport";
import type { TelecomCredentialService } from "../../secrets/telecom-credential.service";

const CERT = "-----BEGIN CERTIFICATE-----\nAAACERTBODY\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nBBBKEYBODY\n-----END PRIVATE KEY-----";
const MTLS_SECRET = JSON.stringify({ cert: CERT, key: KEY });

function make() {
  const postJson = vi.fn();
  const revealForAdapter = vi.fn();
  const transport = { postJson } as unknown as EngineHttpTransport;
  const vault = { revealForAdapter } as unknown as TelecomCredentialService;
  const connector = new KamailioJsonRpcConnector(transport, vault);
  return { connector, postJson, revealForAdapter };
}

const base = {
  provider: TelecomEngineType.KAMAILIO,
  endpoint: "https://10.9.0.1:8443",
  credentialId: "cred-1",
  profile: connectionProfile(TelecomEngineType.KAMAILIO),
  correlationId: "corr-1",
};

beforeEach(() => vi.clearAllMocks());

describe("KamailioJsonRpcConnector — not-contacted (UNKNOWN), no egress", () => {
  it("returns UNKNOWN and calls neither vault nor transport when endpoint is null", async () => {
    const { connector, postJson, revealForAdapter } = make();
    const r = await connector.probe({ ...base, endpoint: null });
    expect(r.status).toBe(HealthStatus.UNKNOWN);
    expect(r.contacted).toBe(false);
    expect(revealForAdapter).not.toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN when no credential is configured (no egress)", async () => {
    const { connector, postJson, revealForAdapter } = make();
    const r = await connector.probe({ ...base, credentialId: null });
    expect(r.status).toBe(HealthStatus.UNKNOWN);
    expect(r.contacted).toBe(false);
    expect(revealForAdapter).not.toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN when the vault reveal fails (no egress)", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockRejectedValueOnce(new Error("Credential not found"));
    const r = await connector.probe(base);
    expect(r.status).toBe(HealthStatus.UNKNOWN);
    expect(r.detail).toMatch(/unavailable/);
    expect(postJson).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN when the credential is the wrong type (no egress)", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.SIP_PASSWORD, secret: MTLS_SECRET });
    const r = await connector.probe(base);
    expect(r.status).toBe(HealthStatus.UNKNOWN);
    expect(r.detail).toMatch(/not an engine management credential/);
    expect(postJson).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN when the credential secret is malformed (no egress)", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValue({ type: TelecomCredentialType.ENGINE_API, secret: "not-json" });
    expect((await connector.probe(base)).detail).toMatch(/malformed/);
    revealForAdapter.mockResolvedValue({ type: TelecomCredentialType.ENGINE_API, secret: JSON.stringify({ cert: CERT }) });
    expect((await connector.probe(base)).status).toBe(HealthStatus.UNKNOWN); // missing key
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe("KamailioJsonRpcConnector — contacted outcomes", () => {
  it("HEALTHY on a valid core.version result; presents the mTLS cert but never leaks the key", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET });
    postJson.mockResolvedValueOnce({ httpStatus: 200, json: { jsonrpc: "2.0", id: "corr-1", result: "kamailio 6.1.5 (x86_64/linux)" } });

    const r = await connector.probe(base);
    expect(r.status).toBe(HealthStatus.HEALTHY);
    expect(r.contacted).toBe(true);
    expect(typeof r.latencyMs).toBe("number");
    expect(r.detail).toContain("6.1.5");

    // The secret is actually USED (cert + key handed to the transport) …
    const sent = postJson.mock.calls[0][0];
    expect(sent.mtls.cert).toContain("BEGIN CERTIFICATE");
    expect(sent.mtls.key).toContain("BEGIN PRIVATE KEY");
    expect(sent.body).toMatchObject({ method: "core.version" });
    // … but it is NEVER echoed into the human-readable detail.
    expect(r.detail).not.toContain("BBBKEYBODY");
    expect(r.detail).not.toContain("PRIVATE KEY");
  });

  it("HEALTHY when core.version returns a {version} object", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET });
    postJson.mockResolvedValueOnce({ httpStatus: 200, json: { jsonrpc: "2.0", result: { version: "kamailio 6.1.5" } } });
    expect((await connector.probe(base)).status).toBe(HealthStatus.HEALTHY);
  });

  it("UNHEALTHY (contacted) on a JSONRPC error object", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET });
    postJson.mockResolvedValueOnce({ httpStatus: 200, json: { jsonrpc: "2.0", error: { code: -32601, message: "method not found" } } });
    const r = await connector.probe(base);
    expect(r.status).toBe(HealthStatus.UNHEALTHY);
    expect(r.contacted).toBe(true);
    expect(r.detail).not.toContain("method not found"); // raw provider text not surfaced
  });

  it("UNHEALTHY (contacted) when the result has no usable version", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET });
    postJson.mockResolvedValueOnce({ httpStatus: 200, json: { jsonrpc: "2.0", result: "" } });
    expect((await connector.probe(base)).status).toBe(HealthStatus.UNHEALTHY);
  });

  it("UNHEALTHY (contacted) on a non-2xx HTTP status", async () => {
    const { connector, postJson, revealForAdapter } = make();
    revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET });
    postJson.mockResolvedValueOnce({ httpStatus: 500, json: undefined });
    const r = await connector.probe(base);
    expect(r.status).toBe(HealthStatus.UNHEALTHY);
    expect(r.contacted).toBe(true);
    expect(r.detail).toContain("500");
  });
});

describe("KamailioJsonRpcConnector — transport failures map to a safe vocabulary (UNKNOWN)", () => {
  const cases: [unknown, RegExp][] = [
    [Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), /connection refused/],
    [new Error("engine request timeout"), /timed out/],
    [Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }), /host not found/],
    [new Error("resolved address is not routable/public: private (10/8)"), /blocked by egress policy/],
    [new Error("self signed certificate"), /TLS verification failed/],
  ];
  for (const [err, re] of cases) {
    it(`maps ${(err as Error).message} → ${re}`, async () => {
      const { connector, postJson, revealForAdapter } = make();
      revealForAdapter.mockResolvedValueOnce({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET });
      postJson.mockRejectedValueOnce(err);
      const r = await connector.probe(base);
      expect(r.status).toBe(HealthStatus.UNKNOWN);
      expect(r.contacted).toBe(false);
      expect(r.detail).toMatch(re);
    });
  }
});
