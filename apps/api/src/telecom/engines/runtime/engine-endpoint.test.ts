import { describe, expect, it } from "vitest";
import { parseEngineEndpoint, classifyIp, assertResolvedIpAllowed, isSafeEngineEndpoint } from "./engine-endpoint";

describe("parseEngineEndpoint — accepts safe public management endpoints", () => {
  it("accepts https/http public hosts and normalizes (no path/query/creds)", () => {
    expect(parseEngineEndpoint("https://kamailio.telvyn.example").ok).toBe(true);
    const r = parseEngineEndpoint("http://sip-edge.telvyn.example:8080/rpc?x=1");
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe("http://sip-edge.telvyn.example:8080"); // path/query stripped
    expect(parseEngineEndpoint("https://8.8.8.8").ok).toBe(true); // public IP literal
  });
});

describe("parseEngineEndpoint — rejects malformed / unsafe schemes", () => {
  const bad: [string, string][] = [
    ["", "empty"],
    ["kamailio.telvyn.example", "no scheme (bare host)"],
    ["ftp://host.example", "ftp scheme"],
    ["file:///etc/passwd", "file scheme"],
    ["ws://host.example", "ws scheme"],
    ["https://user:pass@host.example", "credentials in URL"],
    ["https://host.example\r\nHost: evil", "CRLF injection"],
    ["https://host .example", "whitespace"],
  ];
  it.each(bad)("rejects %s (%s)", (value) => {
    expect(parseEngineEndpoint(value).ok).toBe(false);
  });
});

describe("parseEngineEndpoint — SSRF: blocks non-public hosts", () => {
  const blocked = [
    "https://localhost",
    "https://api.localhost",
    "https://db.internal",
    "https://svc.local",
    "http://127.0.0.1",
    "http://10.0.0.5",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://169.254.169.254", // cloud metadata
    "http://100.64.0.1", // CGNAT
    "http://0.0.0.0",
    "http://224.0.0.1", // multicast
    "http://[::1]", // IPv6 loopback
    "http://[fe80::1]", // link-local
    "http://[fc00::1]", // unique-local
    "http://[::ffff:127.0.0.1]", // IPv4-mapped IPv6 loopback
    "http://[::ffff:169.254.169.254]", // IPv4-mapped metadata
  ];
  it.each(blocked)("blocks %s", (value) => {
    const r = parseEngineEndpoint(value);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe("parseEngineEndpoint — SSRF: blocks alternate IP representations", () => {
  const alt = [
    "http://2130706433", // decimal 127.0.0.1
    "http://0x7f000001", // hex
    "http://0177.0.0.1", // octal
    "http://017700000001", // octal long
  ];
  it.each(alt)("blocks %s", (value) => {
    expect(parseEngineEndpoint(value).ok).toBe(false);
  });
});

describe("classifyIp + assertResolvedIpAllowed (DNS-rebinding recheck)", () => {
  it("classifies public vs non-public correctly", () => {
    expect(classifyIp("8.8.8.8").allowed).toBe(true);
    expect(classifyIp("1.1.1.1").allowed).toBe(true);
    expect(classifyIp("127.0.0.1").allowed).toBe(false);
    expect(classifyIp("10.1.2.3").allowed).toBe(false);
    expect(classifyIp("169.254.169.254").allowed).toBe(false);
    expect(classifyIp("::1").allowed).toBe(false);
    expect(classifyIp("not-an-ip").allowed).toBe(false);
  });
  it("assertResolvedIpAllowed throws for private, passes for public", () => {
    expect(() => assertResolvedIpAllowed("169.254.169.254")).toThrow();
    expect(() => assertResolvedIpAllowed("10.0.0.1")).toThrow();
    expect(() => assertResolvedIpAllowed("8.8.8.8")).not.toThrow();
  });
  it("isSafeEngineEndpoint is the boolean form", () => {
    expect(isSafeEngineEndpoint("https://public.telvyn.example")).toBe(true);
    expect(isSafeEngineEndpoint("http://127.0.0.1")).toBe(false);
  });
});
