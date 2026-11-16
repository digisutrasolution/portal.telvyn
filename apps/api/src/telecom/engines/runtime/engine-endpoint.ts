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

// --- Per-endpoint private-network allowlist (Phase 12M-2) -------------------
/**
 * The canonical policy above denies ALL private ranges. A real engine
 * management plane, however, is reached over a PRIVATE transport — e.g. a
 * WireGuard address `10.9.0.1:8443` fronted by an mTLS gateway. This allowlist
 * authorizes a SPECIFIC private IP + port INDIVIDUALLY. It never blanket-unblocks
 * RFC1918 and never weakens any other check. What keeps it safe:
 *
 *  - Entries match on the IP ADDRESS only — never a hostname. A name can be
 *    rebound to an arbitrary address; an allowlisted literal/resolved IP cannot.
 *    Forbidden hostnames (`localhost`, `*.internal`, …) stay forbidden.
 *  - IPv4 CIDRs must be /24..32 (a blanket `10/8`, `172.16/12`, `192.168/16` is
 *    rejected outright); IPv6 entries must be an exact address (/128).
 *  - A port is MANDATORY per entry; an allowlisted host is reachable ONLY on its
 *    declared port(s).
 *  - The connect-time recheck (`assertResolvedIpAllowed`) consults the SAME
 *    allowlist, so DNS rebinding to a non-allowlisted private IP is still caught.
 *
 * Source: platform-only env `ENGINE_MGMT_ALLOWLIST`, comma-separated
 *   `CIDR@port[;port…]`  e.g. `10.9.0.1/32@8443,10.9.0.2/32@8443`.
 * Malformed entries are IGNORED (fail-closed → that endpoint stays blocked).
 */
export interface EndpointAllowlistEntry {
  family: 4 | 6;
  /** IPv4 network base (uint32, already masked) + prefix length. */
  v4Base?: number;
  v4Prefix?: number;
  /** IPv6 exact (normalized, /128). */
  v6Exact?: string;
  ports: ReadonlySet<number>;
  /** Original non-secret token, for diagnostics. */
  source: string;
}

function ipv4ToUint(ip: string): number | null {
  const o = ip.split(".");
  if (o.length !== 4) return null;
  let n = 0;
  for (const part of o) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function ipv4Mask(prefix: number): number {
  return prefix === 32 ? 0xffffffff : ((0xffffffff << (32 - prefix)) >>> 0);
}

/** Expand an IPv6 literal to its canonical 8-group lowercase form, or null. */
function normalizeIpv6Exact(ip: string): string | null {
  const s = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(s) !== 6) return null;
  if (s.includes(".")) return null; // embedded IPv4 (mapped/compat) — unsupported + blocked elsewhere
  const dbl = s.indexOf("::");
  let groups: string[];
  if (dbl === -1) {
    groups = s.split(":");
    if (groups.length !== 8) return null;
  } else {
    const head = s.slice(0, dbl) ? s.slice(0, dbl).split(":") : [];
    const tail = s.slice(dbl + 2) ? s.slice(dbl + 2).split(":") : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  const out: string[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(g.padStart(4, "0"));
  }
  return out.join(":");
}

/** Parse one allowlist token `CIDR@port[;port…]` → entry, or null if malformed. */
export function parseAllowlistToken(token: string): EndpointAllowlistEntry | null {
  const t = token.trim();
  const at = t.indexOf("@");
  if (at === -1) return null; // a port is mandatory
  const cidr = t.slice(0, at).trim();
  const portPart = t.slice(at + 1).trim();
  if (!cidr || !portPart) return null;

  const ports = new Set<number>();
  for (const p of portPart.split(";")) {
    const pt = p.trim();
    if (!/^[0-9]{1,5}$/.test(pt)) return null;
    const n = Number(pt);
    if (n < 1 || n > 65535) return null;
    ports.add(n);
  }
  if (ports.size === 0) return null;

  const slash = cidr.indexOf("/");
  const addr = (slash === -1 ? cidr : cidr.slice(0, slash)).replace(/^\[|\]$/g, "");
  const prefixStr = slash === -1 ? null : cidr.slice(slash + 1);
  const fam = isIP(addr);

  if (fam === 4) {
    const base = ipv4ToUint(addr);
    if (base === null) return null;
    const prefix = prefixStr === null ? 32 : Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 24 || prefix > 32) return null; // never blanket RFC1918
    return { family: 4, v4Base: (base & ipv4Mask(prefix)) >>> 0, v4Prefix: prefix, ports, source: t };
  }
  if (fam === 6) {
    if (prefixStr !== null && prefixStr !== "128") return null; // IPv6 must be an exact address
    const exact = normalizeIpv6Exact(addr);
    if (!exact) return null;
    return { family: 6, v6Exact: exact, ports, source: t };
  }
  return null;
}

/** Parse the full `ENGINE_MGMT_ALLOWLIST` value. Malformed tokens are dropped (fail-closed). */
export function parseEngineEndpointAllowlist(raw: string | undefined | null): EndpointAllowlistEntry[] {
  if (!raw) return [];
  const out: EndpointAllowlistEntry[] = [];
  for (const tok of raw.split(",")) {
    const entry = parseAllowlistToken(tok);
    if (entry) out.push(entry);
  }
  return out;
}

let _allowlistRaw: string | undefined;
let _allowlistCache: EndpointAllowlistEntry[] = [];
/** Platform allowlist from env, memoized per raw value (re-parses when it changes). */
export function configuredEndpointAllowlist(): EndpointAllowlistEntry[] {
  const raw = process.env.ENGINE_MGMT_ALLOWLIST ?? "";
  if (raw !== _allowlistRaw) {
    _allowlistCache = parseEngineEndpointAllowlist(raw);
    _allowlistRaw = raw;
  }
  return _allowlistCache;
}

function ipMatchesEntry(ipLiteral: string, entry: EndpointAllowlistEntry): boolean {
  const fam = isIP(ipLiteral);
  if (fam !== entry.family) return false;
  if (entry.family === 4) {
    const n = ipv4ToUint(ipLiteral);
    if (n === null || entry.v4Base === undefined || entry.v4Prefix === undefined) return false;
    return ((n & ipv4Mask(entry.v4Prefix)) >>> 0) === entry.v4Base;
  }
  const norm = normalizeIpv6Exact(ipLiteral);
  return norm !== null && norm === entry.v6Exact;
}

/** True iff this exact IP + port is explicitly authorized by the allowlist. */
export function isAllowlistedEndpoint(
  ipLiteral: string,
  port: number | undefined,
  allowlist: EndpointAllowlistEntry[],
): boolean {
  if (port === undefined) return false; // the allowlist always requires a port
  for (const e of allowlist) {
    if (e.ports.has(port) && ipMatchesEntry(ipLiteral, e)) return true;
  }
  return false;
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
export function parseEngineEndpoint(
  raw: string | null | undefined,
  allowlist: EndpointAllowlistEntry[] = configuredEndpointAllowlist(),
): EndpointParseResult {
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

  const ipLiteral = host.replace(/^\[|\]$/g, "");
  const fam = isIP(ipLiteral);
  if (fam === 0 && looksNumericButNotCanonicalIp(host)) {
    return { ok: false, reason: "numeric host must be a canonical dotted-quad IPv4 or bracketed IPv6" };
  }

  let port: number | undefined;
  if (u.port) {
    port = Number(u.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "port out of range" };
  }

  if (fam !== 0) {
    const verdict = classifyIp(ipLiteral);
    // A private IP is permitted ONLY if explicitly allowlisted for this exact IP + port.
    if (!verdict.allowed && !isAllowlistedEndpoint(ipLiteral, port, allowlist)) {
      return { ok: false, reason: `endpoint IP is not routable/public: ${verdict.reason}` };
    }
  }

  const normalized = port ? `${u.protocol}//${host}:${port}` : `${u.protocol}//${host}`;
  return { ok: true, normalized, scheme: u.protocol, host, port };
}

/**
 * Connect-time guard: assert a DNS-resolved IP is reachable per policy — public,
 * or an explicitly allowlisted private IP on the intended port (defeats DNS
 * rebinding to a non-allowlisted address).
 */
export function assertResolvedIpAllowed(ip: string, opts?: { port?: number; allowlist?: EndpointAllowlistEntry[] }): void {
  const verdict = classifyIp(ip);
  if (verdict.allowed) return;
  const allowlist = opts?.allowlist ?? configuredEndpointAllowlist();
  if (isAllowlistedEndpoint(ip, opts?.port, allowlist)) return;
  throw new Error(`resolved address is not routable/public: ${verdict.reason}`);
}

/** Zod-friendly boolean check for config-time endpoint validation. */
export function isSafeEngineEndpoint(raw: string): boolean {
  return parseEngineEndpoint(raw).ok;
}
