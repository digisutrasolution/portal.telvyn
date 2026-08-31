import { describe, expect, it } from "vitest";
import { TelecomEngineType } from "@prisma/client";
import { canonicalize, fingerprintIntent, shortFingerprint } from "./engine-config";
import type { EngineConfigurationIntent } from "../engine.types";

const intent = (over: Partial<EngineConfigurationIntent> = {}): EngineConfigurationIntent => ({
  engineType: TelecomEngineType.KAMAILIO,
  carriers: [{ id: "c1", name: "A", priority: 10, credentialRef: "cred-1" }],
  trunks: [{ id: "t1", name: "T", host: "sip.example", transport: "TLS", credentialRef: "cred-2" }],
  dids: [{ id: "d1", e164: "+15550001111", carrierId: "c1", sipTrunkId: "t1" }],
  routes: [{ id: "r1", destinationType: "SIP_TRUNK", priority: 5 }],
  ...over,
});

describe("fingerprintIntent — deterministic + order-independent (idempotency)", () => {
  it("identical intents → identical fingerprint", () => {
    expect(fingerprintIntent(intent())).toBe(fingerprintIntent(intent()));
  });
  it("array reordering does NOT change the fingerprint (id-normalized)", () => {
    const a = intent({ carriers: [{ id: "c1", name: "A", priority: 10, credentialRef: null }, { id: "c2", name: "B", priority: 20, credentialRef: null }] });
    const b = intent({ carriers: [{ id: "c2", name: "B", priority: 20, credentialRef: null }, { id: "c1", name: "A", priority: 10, credentialRef: null }] });
    expect(fingerprintIntent(a)).toBe(fingerprintIntent(b));
  });
  it("a real config change DOES change the fingerprint", () => {
    expect(fingerprintIntent(intent())).not.toBe(fingerprintIntent(intent({ routes: [{ id: "r1", destinationType: "PHONE_NUMBER", priority: 5 }] })));
  });
  it("carries no secrets", () => {
    expect(canonicalize(intent())).not.toMatch(/secret|password|secretEnc/i);
  });
  it("shortFingerprint is 12 hex chars", () => {
    expect(shortFingerprint(fingerprintIntent(intent()))).toMatch(/^[0-9a-f]{12}$/);
  });
});
