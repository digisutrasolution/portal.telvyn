import { isIP } from "node:net";

/**
 * Canonical SSRF-safe management-endpoint policy for engine RUNTIME egress
 * (Phase 12L). This is the single authority for validating a telecom engine's
 * management endpoint before the control plane would ever contact it.
 *
 * SCOPE: this guards PLATFORM-configured management endpoints (http/https mgmt
 * APIs — Kamailio JSONRPC, FreeSWITCH mod_xml_rpc, Asterisk ARI). Endpoints are
 * NEVER tenant-controlled (platform-only APIs behind PlatformGuard). Raw
 * TCP/ESL/AMI sockets are out of scope for the foundation.
 *
 * It is DISTINCT from the 12H routing-webhook config check (which validates
 * never-called destination URLs at config time). This module is the policy for
 * ACTUAL network egress and is intentionally stricter (DNS-rebinding recheck,
 * IPv4-mapped IPv6, alternate IP representations).
 *
 * Nothing here performs I/O; `assertResolvedIpAllowed` is the connect-time hook
 * a connector calls after DNS resolution to defeat rebinding.
 */

export const ALLOWED_ENDPOINT_SCHEMES = ["http:", "https:"] as const;

export interface EndpointParseResult {
  ok: boolean;
  reason?: string;
  /** Normalized `scheme//host[:port]` (no path/query/creds) when ok. */
  normalized?: string;
  scheme?: string;
  host?: string;
  port?: number;
}

const hasControlOrSpace = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return true;
  }
  return false;
};

/** Strip one trailing dot (FQDN root) and lowercase. */
const canonicalHost = (h: string): string => h.replace(/\.$/, "").toLowerCase();

/** Hostnames that must never be treated as public, independent of DNS. */
function isForbiddenHostname(host: string): boolean {
  const h = canonicalHost(host);
  if (h === "localhost") return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  return false;
}

/**
 * Classify an IP literal as allowed (public) or not. Blocks loopback, RFC1918,
 * link-local, unique-local, multicast, reserved, unspecified, IPv4-mapped IPv6,
 * and NAT64. Returns a reason when blocked.
 */
export function classifyIp(ip: string): { allowed: boolean; reason?: string } {
  const fam = isIP(ip);
  if (fam === 4) return classifyIpv4(ip);
  if (fam === 6) return classifyIpv6(ip.toLowerCase());
  return { allowed: false, reason: "not a valid IP" };
}

function classifyIpv4(ip: string): { allowed: boolean; reason?: string } {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return { allowed: false, reason: "malformed IPv4" };
  const [a, b] = o;
  if (a === 0) return { allowed: false, reason: "unspecified/this-network" };
  if (a === 10) return { allowed: false, reason: "private (10/8)" };
  if (a === 127) return { allowed: false, reason: "loopback (127/8)" };
  if (a === 169 && b === 254) return { allowed: false, reason: "link-local (169.254/16)" };
  if (a === 172 && b >= 16 && b <= 31) return { allowed: false, reason: "private (172.16/12)" };
  if (a === 192 && b === 168) return { allowed: false, reason: "private (192.168/16)" };
  if (a === 100 && b >= 64 && b <= 127) return { allowed: false, reason: "CGNAT (100.64/10)" };
  if (a === 192 && b === 0) return { allowed: false, reason: "reserved (192.0/16)" };
  if (a === 198 && (b === 18 || b === 19)) return { allowed: false, reason: "benchmark (198.18/15)" };
  if (a >= 224) return { allowed: false, reason: "multicast/reserved (>=224)" };
  return { allowed: true };
}

function classifyIpv6(ip: string): { allowed: boolean; reason?: string } {
  if (ip === "::") return { allowed: false, reason: "unspecified (::)" };
  if (ip === "::1") return { allowed: false, reason: "loopback (::1)" };
  if (ip.startsWith("fe80:") || ip.startsWith("fe80::")) return { allowed: false, reason: "link-local (fe80::/10)" };
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return { allowed: false, reason: "unique-local (fc00::/7)" };
  if (ip.startsWith("ff")) return { allowed: false, reason: "multicast (ff00::/8)" };
  // IPv4-mapped (::ffff:*, incl. Node's hex normalization ::ffff:7f00:1) and NAT64
  // (64:ff9b::*) embed an IPv4 — never a legitimate management endpoint. Block outright.
  if (ip.includes("::ffff:") || ip.startsWith("64:ff9b:")) return { allowed: false, reason: "IPv4-embedded IPv6 (mapped/NAT64)" };
  // IPv4-compatible (::a.b.c.d) — recheck the embedded v4.
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (dotted) return classifyIpv4(dotted[1]);
  return { allowed: true };
}

/**
 * A host is a "numeric" host if it is any IP representation. We only accept
 * canonical dotted-quad IPv4 or bracketed/plain IPv6; decimal/octal/hex integer
 * forms (e.g. 2130706433, 0x7f.0.0.1, 0177.0.0.1) are rejected outright to
 * prevent SSRF via alternate representations.
 */
function looksNumericButNotCanonicalIp(host: string): boolean {
  // Pure digits (decimal integer form) or 0x/0-prefixed octets → suspicious.
  if (/^[0-9]+$/.test(host)) return true; // decimal integer IP
  if (/^0x/i.test(host)) return true; // hex
  const parts = host.split(".");
  if (parts.length > 1 && parts.every((p) => /^[0-9]+$/.test(p) || /^0x[0-9a-f]+$/i.test(p) || /^0[0-7]+$/.test(p))) {
    // dotted numeric — allow ONLY canonical decimal dotted-quad; reject octal/hex/short forms.
    if (parts.length !== 4) return true;
    if (parts.some((p) => /^0[0-9]/.test(p) || /^0x/i.test(p))) return true; // leading-zero octal / hex octet
  }
  return false;
}

/**
 * Validate + normalize a management endpoint string. Pure — no DNS, no I/O.
 * Requires an explicit http/https scheme, an explicit safe host, no embedded
 * credentials, no control chars, and (for IP hosts) a public address.
 */
export function parseEngineEndpoint(raw: string | null | undefined): EndpointParseResult {
  if (!raw || raw.length === 0) return { ok: false, reason: "endpoint is empty" };
  if (raw.length > 255) return { ok: false, reason: "endpoint too long" };
  if (hasControlOrSpace(raw)) return { ok: false, reason: "control characters or whitespace are not allowed" };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "must be an absolute http(s) URL (scheme://host[:port])" };
  }

  if (!ALLOWED_ENDPOINT_SCHEMES.includes(u.protocol as (typeof ALLOWED_ENDPOINT_SCHEMES)[number])) {
    return { ok: false, reason: `scheme must be one of ${ALLOWED_ENDPOINT_SCHEMES.join(", ")}` };
  }
  if (u.username || u.password) return { ok: false, reason: "credentials in the URL are not allowed" };
  if (u.hostname.length === 0) return { ok: false, reason: "host is required" };

  const host = canonicalHost(u.hostname);
  if (isForbiddenHostname(host)) return { ok: false, reason: "endpoint host resolves to a local/internal name" };

  const fam = isIP(host.replace(/^\[|\]$/g, ""));
  if (fam === 0 && looksNumericButNotCanonicalIp(host)) {
    return { ok: false, reason: "numeric host must be a canonical dotted-quad IPv4 or bracketed IPv6" };
  }
  if (fam !== 0) {
    const verdict = classifyIp(host.replace(/^\[|\]$/g, ""));
    if (!verdict.allowed) return { ok: false, reason: `endpoint IP is not routable/public: ${verdict.reason}` };
  }

  let port: number | undefined;
  if (u.port) {
    port = Number(u.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "port out of range" };
  }
  const normalized = port ? `${u.protocol}//${host}:${port}` : `${u.protocol}//${host}`;
  return { ok: true, normalized, scheme: u.protocol, host, port };
}

/** Connect-time guard: assert a DNS-resolved IP is public (defeats rebinding). */
export function assertResolvedIpAllowed(ip: string): void {
  const verdict = classifyIp(ip);
  if (!verdict.allowed) throw new Error(`resolved address is not routable/public: ${verdict.reason}`);
}

/** Zod-friendly boolean check for config-time endpoint validation. */
export function isSafeEngineEndpoint(raw: string): boolean {
  return parseEngineEndpoint(raw).ok;
}
