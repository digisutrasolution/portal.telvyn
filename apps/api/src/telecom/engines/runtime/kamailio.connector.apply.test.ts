/**
 * Phase 12N-4b — KamailioJsonRpcConnector.applyConfiguration unit tests. A FAKE
 * in-memory htable transport drives the real dump → diff → sets/delete → verify
 * cycle (no network): happy path, idempotency, stale-delete + foreign isolation,
 * verify-mismatch, timeout, JSONRPC error, invalid config (no egress), and secret
 * hygiene. NullEngineConnector stays honestly NOT_IMPLEMENTED.
 */
import { describe, expect, it } from "vitest";
import { TelecomCredentialType, TelecomEngineType } from "@prisma/client";
import { KamailioJsonRpcConnector } from "./kamailio.connector";
import { NullEngineConnector, type EngineApplyInput } from "./engine-connector";
import { connectionProfile } from "./connection-profiles";
import { EngineErrorCode } from "../engine.types";
import type { EngineHttpTransport } from "./engine-http-transport";
import type { TelecomCredentialService } from "../../secrets/telecom-credential.service";
import type { EngineConfigurationIntent } from "../engine.types";

const CERT = "-----BEGIN CERTIFICATE-----\nAAACERT\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nBBBKEYBODY\n-----END PRIVATE KEY-----";
const MTLS_SECRET = JSON.stringify({ cert: CERT, key: KEY });
const TRUNK = "01a1e724-0000-7000-8000-000000000001";

interface FakeOpts {
  seed?: Record<string, string>;
  throwOn?: string; // method name to throw a timeout on
  errorOn?: string; // method name to return a JSONRPC error on
  dropSets?: boolean; // ignore htable.sets so verify fails
}

function fakeEngine(opts: FakeOpts = {}) {
  const state = new Map<string, string>(Object.entries(opts.seed ?? {}));
  const calls: { method: string; params: unknown[] }[] = [];
  const postJson = async ({ body }: { body: { method: string; params: unknown[] } }) => {
    calls.push({ method: body.method, params: body.params });
    if (opts.throwOn === body.method) throw new Error("engine request timeout");
    if (opts.errorOn === body.method) return { httpStatus: 200, json: { error: { code: -1, message: "boom" } } };
    if (body.method === "htable.dump") {
      return { httpStatus: 200, json: { result: [...state].map(([name, value]) => ({ item: { name, value } })) } };
    }
    if (body.method === "htable.sets") {
      if (!opts.dropSets) state.set(String(body.params[1]), String(body.params[2]));
      return { httpStatus: 200, json: { result: "ok" } };
    }
    if (body.method === "htable.delete") {
      state.delete(String(body.params[1]));
      return { httpStatus: 200, json: { result: "ok" } };
    }
    return { httpStatus: 200, json: { result: null } };
  };
  const transport = { postJson } as unknown as EngineHttpTransport;
  const vault = { revealForAdapter: async () => ({ type: TelecomCredentialType.ENGINE_API, secret: MTLS_SECRET }) } as unknown as TelecomCredentialService;
  return { connector: new KamailioJsonRpcConnector(transport, vault), state, calls };
}

const intent = (over: Partial<EngineConfigurationIntent> = {}): EngineConfigurationIntent => ({
  engineType: TelecomEngineType.KAMAILIO,
  carriers: [],
  trunks: [{ id: TRUNK, name: "t", host: "h", transport: "UDP", credentialRef: null }],
  dids: [{ id: "d1", e164: "+14155550100", carrierId: null, sipTrunkId: TRUNK }],
  routes: [],
  ...over,
});

const input = (over: Partial<EngineApplyInput> = {}): EngineApplyInput => ({
  provider: TelecomEngineType.KAMAILIO,
  endpoint: "https://10.9.0.1:8443",
  credentialId: "cred-1",
  profile: connectionProfile(TelecomEngineType.KAMAILIO),
  correlationId: "cid",
  intent: intent(),
  ...over,
});

describe("applyConfiguration — guards (no egress)", () => {
  it("UNAVAILABLE when endpoint/credential missing, transport untouched", async () => {
    const a = fakeEngine();
    expect((await a.connector.applyConfiguration(input({ endpoint: null }))).code).toBe(EngineErrorCode.UNAVAILABLE);
    const b = fakeEngine();
    expect((await b.connector.applyConfiguration(input({ credentialId: null }))).code).toBe(EngineErrorCode.UNAVAILABLE);
    expect(a.calls.length + b.calls.length).toBe(0);
  });

  it("INVALID_CONFIG for a malformed desired set, with NO egress", async () => {
    const a = fakeEngine();
    const r = await a.connector.applyConfiguration(input({ intent: intent({ dids: [{ id: "d", e164: "notaphone", carrierId: null, sipTrunkId: null }] }) }));
    expect(r.code).toBe(EngineErrorCode.INVALID_CONFIG);
    expect(a.calls.length).toBe(0);
  });
});

describe("applyConfiguration — diff/apply/verify", () => {
  it("applies to an empty engine and VERIFIES (OK, applied), secret never leaks", async () => {
    const a = fakeEngine();
    const r = await a.connector.applyConfiguration(input());
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(true);
    expect(r.setOps).toBe(2); // trunk + did
    expect(a.state.get("did:+14155550100")).toBe(TRUNK);
    expect(a.state.get(`trunk:${TRUNK}`)).toBe("UDP");
    // only the telvyn htable is ever named
    expect(a.calls.every((c) => c.params[0] === "telvyn")).toBe(true);
    expect(r.detail).not.toContain("BBBKEYBODY");
  });

  it("is idempotent — a second apply is a 0-op NOOP", async () => {
    const a = fakeEngine();
    await a.connector.applyConfiguration(input());
    const callsAfterFirst = a.calls.length;
    const r2 = await a.connector.applyConfiguration(input());
    expect(r2.ok).toBe(true);
    expect(r2.setOps).toBe(0);
    expect(r2.delOps).toBe(0);
    // only 1 dump + 1 verify dump on the idempotent run (no sets/deletes)
    expect(a.calls.length - callsAfterFirst).toBe(2);
  });

  it("deletes stale MANAGED keys but never touches foreign keys", async () => {
    const a = fakeEngine({ seed: { "route:stale": "x", "foreign:keep": "y" } });
    const r = await a.connector.applyConfiguration(input());
    expect(r.ok).toBe(true);
    expect(a.state.has("route:stale")).toBe(false); // deleted
    expect(a.state.get("foreign:keep")).toBe("y"); // untouched
    expect(a.calls.some((c) => c.method === "htable.delete" && c.params[1] === "foreign:keep")).toBe(false);
  });

  it("APPLY_INCOMPLETE when the re-dump does not match desired", async () => {
    const a = fakeEngine({ dropSets: true });
    const r = await a.connector.applyConfiguration(input());
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.outcome).toBe("APPLY_INCOMPLETE");
  });
});

describe("applyConfiguration — failure mapping", () => {
  it("TIMEOUT during an op → code TIMEOUT, not applied", async () => {
    const a = fakeEngine({ throwOn: "htable.sets" });
    const r = await a.connector.applyConfiguration(input());
    expect(r.code).toBe(EngineErrorCode.TIMEOUT);
    expect(r.applied).toBe(false);
  });

  it("a JSONRPC error → UNAVAILABLE, not applied", async () => {
    const a = fakeEngine({ errorOn: "htable.dump" });
    const r = await a.connector.applyConfiguration(input());
    expect(r.code).toBe(EngineErrorCode.UNAVAILABLE);
    expect(r.applied).toBe(false);
  });
});

describe("NullEngineConnector.applyConfiguration", () => {
  it("is honestly NOT_IMPLEMENTED (no egress)", async () => {
    const r = await new NullEngineConnector().applyConfiguration(input());
    expect(r.code).toBe(EngineErrorCode.NOT_IMPLEMENTED);
    expect(r.applied).toBe(false);
  });
});
