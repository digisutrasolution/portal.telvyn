import { describe, expect, it } from "vitest";
import { HealthStatus, TelecomEngineType } from "@prisma/client";
import { EngineService, type EngineConfigurationSource } from "./engine.service";
import { EngineError, EngineErrorCode } from "./engine.types";
import { KamailioAdapter } from "./adapters/kamailio.adapter";
import { AsteriskAdapter } from "./adapters/asterisk.adapter";
import type { TelecomEngineAdapter } from "./engine-adapter.interface";

function makeService(adapter: Partial<TelecomEngineAdapter>): EngineService {
  const full: TelecomEngineAdapter = {
    type: TelecomEngineType.KAMAILIO,
    implemented: false,
    describeCapabilities: () => [],
    capabilities: () => ({ health: true, routing: true, registration: true, activeCalls: true, originate: false, configuration: true }),
    healthCheck: async () => ({ status: HealthStatus.UNKNOWN, detail: "stub" }),
    applyConfiguration: async () => {
      throw new EngineError(EngineErrorCode.NOT_IMPLEMENTED, "nope");
    },
    ...adapter,
  };
  const registry = { getAdapter: () => full } as unknown as ConstructorParameters<typeof EngineService>[0];
  return new EngineService(registry);
}
const engine = { id: "00000000-0000-7000-8000-000000000001", type: TelecomEngineType.KAMAILIO };

describe("EngineService.getStatus", () => {
  it("returns honest UNKNOWN health + explicit capabilities + correlationId", async () => {
    const svc = makeService({});
    const s = await svc.getStatus(engine);
    expect(s.implemented).toBe(false);
    expect(s.health.status).toBe(HealthStatus.UNKNOWN);
    expect(s.capabilities.routing).toBe(true);
    expect(s.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("handles a hanging health probe via the bounded timeout (never throws)", async () => {
    const svc = makeService({ healthCheck: () => new Promise(() => {}) }); // never resolves
    const s = await svc.getStatus(engine, 20); // 20ms timeout
    expect(s.health.status).toBe(HealthStatus.UNKNOWN);
    expect(s.health.detail).toMatch(/timeout/i);
  });
});

describe("EngineService.sync (honest NOT_IMPLEMENTED)", () => {
  it("normalizes a stub adapter's NOT_IMPLEMENTED into a result (no fake success)", async () => {
    const svc = makeService({});
    const r = await svc.sync(engine, svc.buildConfigurationIntent({ engineType: engine.type, carriers: [], trunks: [], dids: [], routes: [] }));
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("NOT_IMPLEMENTED");
    expect(r.code).toBe(EngineErrorCode.NOT_IMPLEMENTED);
    expect(r.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("EngineService.normalizeError", () => {
  it("maps EngineError codes; suppresses unknown-error detail (no leakage)", () => {
    const asEngine = makeService({}).normalizeError(new EngineError(EngineErrorCode.TIMEOUT, "boom"), "cid", 1);
    expect(asEngine.code).toBe(EngineErrorCode.TIMEOUT);
    const asUnknown = makeService({}).normalizeError(new Error("secret-ish internal detail"), "cid", 1);
    expect(asUnknown.code).toBe(EngineErrorCode.INTERNAL);
    expect(asUnknown.detail).toBe("engine operation failed"); // original message not leaked
  });
});

describe("EngineService.buildConfigurationIntent (pure, secret-free)", () => {
  it("reduces credentials to id references and carries no secrets", () => {
    const src: EngineConfigurationSource = {
      engineType: TelecomEngineType.KAMAILIO,
      carriers: [{ id: "c1", name: "A", priority: 10, credentialId: "cred-1" }],
      trunks: [{ id: "t1", name: "T", host: "sip.example.com", transport: "TLS", credentialId: "cred-2" }],
      dids: [{ id: "d1", e164: "+919876543210", carrierId: "c1", sipTrunkId: "t1" }],
      routes: [{ id: "r1", destinationType: "SIP_TRUNK", priority: 5 }],
    };
    const intent = makeService({}).buildConfigurationIntent(src);
    expect(intent.carriers[0].credentialRef).toBe("cred-1");
    expect(intent.trunks[0].credentialRef).toBe("cred-2");
    const json = JSON.stringify(intent);
    expect(json).not.toMatch(/secret|password|secretEnc/i);
  });
});

describe("adapter capabilities are explicit + honest", () => {
  it("Kamailio (signalling) does not originate; Asterisk (PBX) does", () => {
    expect(new KamailioAdapter().capabilities().originate).toBe(false);
    expect(new KamailioAdapter().capabilities().routing).toBe(true);
    expect(new AsteriskAdapter().capabilities().originate).toBe(true);
  });
});
