/**
 * Phase 12M-2 — per-endpoint private-network allowlist.
 *
 * The canonical SSRF policy denies all private ranges; this allowlist authorizes
 * a SPECIFIC private IP + port (e.g. a WireGuard management address) individually,
 * never blanket-unblocking RFC1918 and never weakening any other check. These
 * tests prove: strict token parsing (fail-closed), exact IP+port matching, the
 * integration into parse/connect-time validation, and that every other guard
 * still holds in the presence of an allowlist.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAllowlistToken,
  parseEngineEndpointAllowlist,
  configuredEndpointAllowlist,
  isAllowlistedEndpoint,
  parseEngineEndpoint,
  assertResolvedIpAllowed,
  type EndpointAllowlistEntry,
} from "./engine-endpoint";

const WG = parseEngineEndpointAllowlist("10.9.0.1/32@8443");

describe("parseAllowlistToken — accepts narrow, explicit entries", () => {
  it("accepts a bare IPv4 (implicit /32) with a port", () => {
    const e = parseAllowlistToken("10.9.0.1@8443");
    expect(e).not.toBeNull();
    expect(e!.family).toBe(4);
    expect(e!.v4Prefix).toBe(32);
    expect([...e!.ports]).toEqual([8443]);
  });
  it("accepts an explicit /24..32 CIDR and multiple ports", () => {
    const e = parseAllowlistToken("10.9.0.0/24@8443;9443");
    expect(e).not.toBeNull();
    expect(e!.v4Prefix).toBe(24);
    expect(e!.ports.has(8443)).toBe(true);
    expect(e!.ports.has(9443)).toBe(true);
  });
  it("accepts an exact IPv6 address (/128, implicit or explicit)", () => {
    expect(parseAllowlistToken("fd00::1@8443")).not.toBeNull();
    expect(parseAllowlistToken("fd00::1/128@8443")).not.toBeNull();
  });
});

describe("parseAllowlistToken — rejects blanket / malformed (fail-closed)", () => {
  const bad = [
    ["10.0.0.0/8@8443", "blanket 10/8"],
    ["172.16.0.0/12@8443", "blanket 172.16/12"],
    ["192.168.0.0/16@8443", "blanket 192.168/16"],
    ["10.9.0.0/23@8443", "prefix broader than /24"],
    ["10.9.0.1/33@8443", "prefix out of range"],
    ["10.9.0.1/32", "no port"],
    ["10.9.0.1@0", "port 0"],
    ["10.9.0.1@70000", "port out of range"],
    ["10.9.0.1@abc", "non-numeric port"],
    ["not-an-ip@8443", "hostname, not an IP"],
    ["fd00::1/64@8443", "non-exact IPv6 prefix"],
    ["@8443", "empty cidr"],
    ["10.9.0.1@", "empty port"],
  ] as const;
  for (const [tok, why] of bad) {
    it(`rejects ${why}: ${tok}`, () => expect(parseAllowlistToken(tok)).toBeNull());
  }
});

describe("parseEngineEndpointAllowlist — drops malformed tokens, keeps valid", () => {
  it("ignores bad entries (fail-closed) and keeps the good ones", () => {
    const list = parseEngineEndpointAllowlist("10.9.0.1/32@8443, 10.0.0.0/8@8443 , 10.9.0.2@8443");
    expect(list).toHaveLength(2); // the blanket /8 is dropped
    expect(list.map((e) => e.source).some((s) => s.includes("10.9.0.1"))).toBe(true);
  });
  it("returns [] for empty/undefined", () => {
    expect(parseEngineEndpointAllowlist("")).toEqual([]);
    expect(parseEngineEndpointAllowlist(undefined)).toEqual([]);
  });
});

describe("isAllowlistedEndpoint — exact IP + port matching only", () => {
  const cidr: EndpointAllowlistEntry[] = parseEngineEndpointAllowlist("10.9.0.0/24@8443");
  it("matches an IP inside the CIDR on the declared port", () => {
    expect(isAllowlistedEndpoint("10.9.0.1", 8443, WG)).toBe(true);
    expect(isAllowlistedEndpoint("10.9.0.254", 8443, cidr)).toBe(true);
  });
  it("rejects the wrong port", () => expect(isAllowlistedEndpoint("10.9.0.1", 9999, WG)).toBe(false));
  it("rejects an IP outside the CIDR", () => {
    expect(isAllowlistedEndpoint("10.9.1.1", 8443, cidr)).toBe(false);
    expect(isAllowlistedEndpoint("10.9.0.2", 8443, WG)).toBe(false); // /32 is exact
  });
  it("rejects a missing port", () => expect(isAllowlistedEndpoint("10.9.0.1", undefined, WG)).toBe(false));
  it("rejects a family mismatch", () => expect(isAllowlistedEndpoint("fd00::1", 8443, WG)).toBe(false));
  it("matches an exact IPv6 entry regardless of written form", () => {
    const v6 = parseEngineEndpointAllowlist("fd00:0:0:0:0:0:0:1@8443");
    expect(isAllowlistedEndpoint("fd00::1", 8443, v6)).toBe(true);
  });
});

describe("parseEngineEndpoint — allowlist permits the specific private endpoint only", () => {
  it("permits the allowlisted private IP + port", () => {
    const r = parseEngineEndpoint("https://10.9.0.1:8443", WG);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe("https://10.9.0.1:8443");
  });
  it("still blocks the same private IP WITHOUT an allowlist", () => {
    const r = parseEngineEndpoint("https://10.9.0.1:8443", []);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private \(10\/8\)/);
  });
  it("blocks the allowlisted IP on a non-allowlisted port", () => {
    expect(parseEngineEndpoint("https://10.9.0.1:9999", WG).ok).toBe(false);
  });
  it("blocks a DIFFERENT private IP not in the allowlist", () => {
    expect(parseEngineEndpoint("https://10.9.0.2:8443", WG).ok).toBe(false);
    expect(parseEngineEndpoint("https://192.168.1.10:8443", WG).ok).toBe(false);
  });
  it("still blocks forbidden hostnames even with an allowlist (names never match an IP allowlist)", () => {
    expect(parseEngineEndpoint("https://foo.internal:8443", WG).ok).toBe(false);
    expect(parseEngineEndpoint("https://localhost:8443", WG).ok).toBe(false);
  });
  it("leaves public endpoints unaffected when an allowlist is present", () => {
    expect(parseEngineEndpoint("https://8.8.8.8:8443", WG).ok).toBe(true);
    expect(parseEngineEndpoint("https://kamailio.telvyn.example", WG).ok).toBe(true);
  });
});

describe("assertResolvedIpAllowed — connect-time rebinding defence honours the allowlist", () => {
  it("allows a public resolved IP", () => expect(() => assertResolvedIpAllowed("8.8.8.8")).not.toThrow());
  it("throws for a private resolved IP with no allowlist", () => {
    expect(() => assertResolvedIpAllowed("10.9.0.1", { port: 8443 })).toThrow(/not routable\/public/);
  });
  it("allows a private resolved IP that is allowlisted for the intended port", () => {
    expect(() => assertResolvedIpAllowed("10.9.0.1", { port: 8443, allowlist: WG })).not.toThrow();
  });
  it("throws when rebinding resolves to an allowlisted host but the WRONG port", () => {
    expect(() => assertResolvedIpAllowed("10.9.0.1", { port: 9999, allowlist: WG })).toThrow(/not routable\/public/);
  });
  it("throws when rebinding resolves to a different private IP", () => {
    expect(() => assertResolvedIpAllowed("10.9.0.2", { port: 8443, allowlist: WG })).toThrow(/not routable\/public/);
  });
});

describe("configuredEndpointAllowlist — reads platform env, memoized", () => {
  const original = process.env.ENGINE_MGMT_ALLOWLIST;
  afterEach(() => {
    if (original === undefined) delete process.env.ENGINE_MGMT_ALLOWLIST;
    else process.env.ENGINE_MGMT_ALLOWLIST = original;
    configuredEndpointAllowlist(); // reset the memo to the restored value
  });
  it("is empty by default (no env) — policy unchanged", () => {
    delete process.env.ENGINE_MGMT_ALLOWLIST;
    expect(configuredEndpointAllowlist()).toEqual([]);
  });
  it("reflects the env value and gates parseEngineEndpoint without an explicit arg", () => {
    process.env.ENGINE_MGMT_ALLOWLIST = "10.9.0.1/32@8443";
    expect(configuredEndpointAllowlist()).toHaveLength(1);
    expect(parseEngineEndpoint("https://10.9.0.1:8443").ok).toBe(true); // uses env default
    delete process.env.ENGINE_MGMT_ALLOWLIST;
    expect(parseEngineEndpoint("https://10.9.0.1:8443").ok).toBe(false); // back to deny
  });
});
