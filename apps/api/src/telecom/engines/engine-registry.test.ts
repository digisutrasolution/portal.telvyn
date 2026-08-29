import { describe, expect, it } from "vitest";
import { EngineCapabilityKey, HealthStatus, TelecomEngineType } from "@prisma/client";
import { EngineRegistryService } from "./engine-registry.service";
import { KamailioAdapter } from "./adapters/kamailio.adapter";
import { AsteriskAdapter } from "./adapters/asterisk.adapter";
import { FreeSwitchAdapter } from "./adapters/freeswitch.adapter";

const registry = new EngineRegistryService(new KamailioAdapter(), new AsteriskAdapter(), new FreeSwitchAdapter());
const ALL_TYPES = Object.values(TelecomEngineType);
const VALID_CAPS = new Set<string>(Object.values(EngineCapabilityKey));

describe("engine registry (ADR-0007)", () => {
  it("resolves an adapter for every engine type, of the matching type", () => {
    for (const type of ALL_TYPES) {
      expect(registry.getAdapter(type).type).toBe(type);
    }
  });

  it("registers exactly the three known engines", () => {
    expect(registry.listAdapters().map((a) => a.type).sort()).toEqual([...ALL_TYPES].sort());
  });

  it("throws honestly on an unregistered engine type", () => {
    expect(() => registry.getAdapter("BOGUS" as TelecomEngineType)).toThrow(/No telecom engine adapter/);
  });
});

describe("engine adapters are honest stubs (Phase 12C)", () => {
  it("every adapter reports implemented = false", () => {
    for (const type of ALL_TYPES) {
      expect(registry.isImplemented(type)).toBe(false);
    }
  });

  it("healthCheck() returns UNKNOWN — never a fabricated HEALTHY", async () => {
    for (const type of ALL_TYPES) {
      const health = await registry.getAdapter(type).healthCheck();
      expect(health.status).toBe(HealthStatus.UNKNOWN);
      expect(health.status).not.toBe(HealthStatus.HEALTHY);
      expect(health.detail).toMatch(/not implemented/i);
    }
  });

  it("describeCapabilities() returns a non-empty, valid capability profile including SIP", () => {
    for (const type of ALL_TYPES) {
      const caps = registry.getAdapter(type).describeCapabilities();
      expect(caps.length).toBeGreaterThan(0);
      expect(new Set(caps).size).toBe(caps.length); // no duplicates
      for (const c of caps) expect(VALID_CAPS.has(c)).toBe(true);
      expect(caps).toContain(EngineCapabilityKey.SIP);
    }
  });

  it("declares media capabilities only where the engine software actually provides them", () => {
    // Kamailio is a signalling proxy — it does not declare RTP/media itself.
    expect(registry.getAdapter(TelecomEngineType.KAMAILIO).describeCapabilities()).not.toContain(EngineCapabilityKey.RTP);
    // Asterisk and FreeSWITCH are media-capable.
    expect(registry.getAdapter(TelecomEngineType.ASTERISK).describeCapabilities()).toContain(EngineCapabilityKey.RTP);
    expect(registry.getAdapter(TelecomEngineType.FREESWITCH).describeCapabilities()).toContain(EngineCapabilityKey.TTS);
  });
});
