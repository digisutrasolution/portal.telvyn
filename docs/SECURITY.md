# SECURITY.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md (EXISTING / PLANNED / PROPOSED / UNKNOWN).
> Severity scale used by audits: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

## Current state — EXISTING

> **Updated 2026-08-29.** The original pre-code audit below (2026-08-26) is
> retained as history. Application code now exists (auth + tenancy + RBAC
> backend, static web shell). Implemented controls and the pre-Phase-12
> hardening are recorded in **"Implemented controls (2026-08-29)"** near the
> end of this document; read that section for what is actually in force today.

This document records: (1) the original defensive audit of repository content,
(2) the severity-classified findings register, (3) the committed control set,
(4) the 30-area security baseline every feature must ship against, and (5) the
**implemented** control set as of the pre-Phase-12 hardening pass.

---

## Defensive security audit — 2026-08-26

### Scope & methodology (OWASP-aligned, non-destructive)

- **Auditable surface today:** the repository's 17 Markdown files. No source
  code, configuration, environment files, CI definitions, or infrastructure
  exist; no system is running anywhere. Nothing was exploited or modified.
- **Performed:** full file inventory; secret scan (API keys, passwords,
  private-key blocks, provider token formats, bearer strings); sensitive-data
  scan (IP addresses, email addresses, connection strings/DSNs); search for
  config/env/certificate files; design review of the documented architecture
  against OWASP Top 10 / ASVS themes and telecom-specific practice (toll
  fraud, porting fraud, carrier credential handling).
- **Not performable (nothing exists):** code review of authn/z, session, JWT,
  CORS/CSRF/XSS/SQLi/SSRF handling, upload handling, webhook verification,
  rate limiting, tenant isolation. These become the standing baseline (§ below)
  and are re-audited when code exists.

### Findings register (prioritized)

| ID | Severity | Finding | Recommended fix (not yet implemented) |
|---|---|---|---|
| SEC-001 | **CRITICAL** (design gate) | **Tenant/customer isolation mechanism undecided** (= DB-002). Constitution mandates data-layer isolation, but app-scoped filtering vs PostgreSQL RLS is unresolved. Every week of feature work done before this decision multiplies retrofit risk; cross-tenant leakage is ranked #3 in the architecture risk register. | Resolve by ADR before the first migration; include automated tests that prove cross-owner queries return nothing. |
| SEC-002 | **HIGH** (design gate) | **Toll-fraud control design is principles-only.** "Spend/velocity/geo limits + balance checks" is locked in the constitution, but there is no concrete specification: no limit model, no default thresholds, no lock-down flow, no alerting rule. Toll fraud is the #1 ranked risk — an implementation gap here is existential, and telecom fraud starts within hours of exposure, not weeks. | Write the toll-fraud control spec (limits model, defaults, kill-switch, alert → RUNBOOK path) as part of the first call-affecting feature's design — that feature does not ship without it. |
| SEC-003 | **HIGH** | **No enforcement vehicle for the security process.** No git repository, no branch protection, no CI — so the constitution's gates (dependency audit, tests, security review in DoD, no red-main merges) are currently unenforceable by tooling. Human discipline is the only control. | `git init` + remote with protected main; CI skeleton (lint/typecheck/test/dependency-audit) as part of the repo scaffold — before feature code, not after. |
| SEC-004 | MEDIUM | **Port-out / LOA anti-hijack process undefined.** Number hijacking via forged port-out is a top telecom attack; only a PROPOSED PIN/approval flow exists, with no decided KYC/verification procedure (markets are UNKNOWN). | Decide port-out authorization flow (PIN + step-up MFA + notification-with-delay PROPOSED) in the porting-module ADR; align KYC to chosen markets. |
| SEC-005 | MEDIUM | **Payment rails undecided → compliance posture unknowable.** PCI scope (cards), AML/KYC + sanctions screening (crypto), and chargeback fraud handling all depend on the rail choice. No payment code exists, so no current exposure — but no compliance program can be scoped either. | Owner decides rails (BILLING.md UNKNOWN #2); document the compliance obligations of the chosen rails in this file before integration. |
| SEC-006 | MEDIUM | **Secret management is unchosen and the env contract doesn't exist yet.** No `.env.example`, no secret-manager decision. Nothing can leak today, but the first line of runnable code will need secrets, and ad-hoc handling at that moment is how credentials end up in git. | Choose the secret store with the hosting ADR; create `.env.example` (placeholders only) in the repo scaffold; add a secret-scan pre-commit/CI hook from day one. |
| SEC-007 | LOW | **Admin-operation safeguards are partially specified.** Step-up MFA on money/provisioning actions is locked, but maker-checker for manual credits and any impersonation feature are PROPOSED/undecided. | Ratify maker-checker for manual ledger credits; if impersonation is ever wanted, it requires its own ADR + full audit trail (already noted in ARCHITECTURE.md §6). |
| SEC-008 | INFORMATIONAL | **Secret & sensitive-data scan: CLEAN.** Zero credentials, private keys, provider tokens, connection strings, IP addresses, or personal emails in the repository. All pattern hits are design vocabulary ("token", "secret manager"). No config/cert/env files present. | Keep it that way: the CI secret-scan gate (SEC-006) makes this a machine-enforced property. |
| SEC-009 | INFORMATIONAL | **No exploitable runtime exists.** SQLi/XSS/CSRF/SSRF/IDOR/session attacks have no target. The 30-area baseline below is the contract that keeps it true as code lands. | Re-run this audit at the end of Phase 1 against real code. |

### Priority order for action

1. SEC-001 — isolation ADR (blocks all schema/feature work)
2. SEC-003 — git + CI enforcement skeleton (blocks safe collaboration)
3. SEC-002 — toll-fraud spec (blocks the first call-affecting feature)
4. SEC-006 — secret store + env contract (blocks the first runnable code)
5. SEC-004 / SEC-005 / SEC-007 — decided with their module ADRs (porting, billing, admin)

---

## Security baseline — the 30 audited areas

Every area below has **status: NOT BUILT** (no code exists). The table is the
per-area contract; a feature touching an area ships with its controls, tested.
OWASP refs: T10 = OWASP Top 10 2021, ASVS = Application Security Verification
Standard v4.

| Area | Required controls (PLANNED unless marked) | Ref |
|---|---|---|
| Authentication | argon2id (tuned, documented params); no password auth bypasses; generic failure messages | T10 A07, ASVS V2 |
| Authorization | Deny-by-default; per-route permission key checks; unguarded route = request fails | T10 A01, ASVS V4 |
| RBAC | Granular permission catalogue in DB; seed-migrated; tests assert route↔permission coverage | ASVS V4 |
| Sessions | Server-side revocable session records (IP/UA); absolute + idle expiry; logout revokes family | ASVS V3 |
| JWT | Short-lived access tokens; strong alg pinned (no `none`/alg confusion); aud/iss validated; clock-skew tolerance defined | ASVS V3 |
| Refresh tokens | Rotation on every use + reuse detection → revoke token family; stored hashed | ASVS V3 |
| MFA | TOTP for all, mandatory for admins; step-up on money/provisioning; ±1 step window; enrollment enforced at first admin login | ASVS V2.8 |
| Passwords | argon2id; min-length + breach-list check (PROPOSED); no composition theatre; rate-limited change/reset flows | ASVS V2.1 |
| API security | Contract-first validation of ALL input (DTO/schema); RFC 7807 errors without stack traces; request-size caps; UUIDs not sequential ids | T10 A03/A04 |
| CORS | Explicit allowlist of portal origins only; no `*` with credentials | ASVS V13 |
| CSRF | Anti-CSRF tokens or SameSite=strict on any cookie-auth surface; state-changing routes never GET | ASVS V4.2 |
| XSS | Framework auto-escaping + CSP (no unsafe-inline goal); output encoding; sanitize any rich-text if ever introduced | T10 A03, ASVS V5 |
| SQL injection | Parameterized queries ONLY; no string-built SQL; ORM raw-query use reviewed case-by-case | T10 A03 |
| SSRF | Outbound allowlist (carrier/payment endpoints); no user-supplied URLs fetched server-side without validation + IP-range denylist (link-local/RFC1918) | T10 A10 |
| File uploads | Only if needed (LOA docs): type/size validation, content sniffing, stored in object storage (never web root), served via signed URLs, AV scan PROPOSED | ASVS V12 |
| Webhooks | Signature verification per provider; replay window + dedupe by event id; no side effects on unverified payloads | ASVS V13 |
| Secrets | Secret manager only; DB stores references; zero secrets in git (machine-enforced scan, SEC-006) | T10 A05 |
| Environment variables | `.env.example` documents every variable with safe placeholders; prod env injected by host/manager, never committed | ASVS V14 |
| Tenant isolation | Data-layer enforcement (mechanism per SEC-001 ADR); cross-owner test suite | T10 A01 |
| IDOR | Ownership check on every single-resource fetch (not just lists); UUID ids | T10 A01 |
| Rate limiting | Per-IP + per-account limits on auth and public endpoints; fail CLOSED if the limiter store is down | ASVS V11 |
| Brute force | Progressive lockout/backoff on login + MFA verify; alerts on credential-stuffing patterns | ASVS V2.2 |
| Audit logs | Append-only; same-transaction as mutation; actor/action/entity/metadata/IP; denials logged; no secrets/PII in logs (redaction rules) | ASVS V7 |
| Payment security | No card data ever stored/relayed (rail-dependent, SEC-005); provider webhooks verified; refunds maker-checker (PROPOSED) | PCI-DSS scope-out |
| Wallet security | Balances derived from ledger; idempotency on every post; no admin set-balance; reconciliation alerting | — |
| SIP security | Only if SIP/RTP ever operated: TLS/SRTP, public-IP hosts outside CDN, fail2ban-class scanning defense, no default credentials, SIP ALG documented off | Telecom practice |
| Toll fraud controls | Concrete spec per SEC-002: spend/velocity/geo limits, balance gates before routing changes, kill-switch, real-time alerts | Telecom practice |
| Carrier credentials | Vaulted, least-privilege per integration; rotation runbook; never in DB rows or logs | ASVS V14 |
| Admin operations | Step-up MFA; audited; maker-checker on manual credits (PROPOSED); no impersonation without dedicated ADR + trail | ASVS V4 |

---

## Process — PLANNED

- Dependency audit + secret scan in CI (SEC-003/SEC-006); lockfiles committed.
- Security review is part of definition-of-done for every feature.
- This audit re-runs at the end of each phase against the real code; findings
  register is append-only (resolved findings get marked, not deleted).
- Incident response procedures live in RUNBOOK.md.

## UNKNOWN

- Compliance obligations (KYC/AML, data protection, PCI applicability) —
  follow from UNKNOWN launch markets and payment rails (SEC-005).
- Secret-manager choice — follows hosting decision (SEC-006).

---

## Phase 2 — Authentication foundation IMPLEMENTED (2026-08-27)

Backend: NestJS API (`apps/api`) + PostgreSQL (Prisma) + Redis, per ADR-0003.
Contract-first: `packages/contracts/openapi/telvyn.v1.yaml` authored first.

### Inspection result (migration analysis)
The only prior "auth" was the frontend shell's typed **null-session seam**
(`shell-config.ts`, `user-menu.tsx`) — no implementation existed, so **nothing
was broken and NO migration was required**. The seam was designed for exactly
this wiring; the web client consumes the new API unchanged in shape.

### Findings closed / advanced

| ID | Prior severity | Now |
|---|---|---|
| SEC-003 | HIGH — no git/CI enforcement vehicle | **Partly closed**: git initialized (Phase 1); env is boundary-validated (Zod, fail-fast); dep set pinned. CI pipeline still to wire (Phase 20 / DEVOPS). |
| SEC-006 | MEDIUM — no secret store / env contract | **Closed for dev**: `.env.example` documents every var; secrets Zod-validated at boot; `.env` gitignored; MFA secrets encrypted at rest (AES-256-GCM). Managed secret store still a prod deploy decision. |
| DB-007 | LOW — UUIDv7 mechanism unpinned | **Closed**: PostgreSQL 18 native `uuidv7()` pinned (ADR-0003). |

### Controls implemented (SECURITY.md baseline → EXISTING)

- **Authentication**: argon2id (m=64MiB,t=3,p=4), opportunistic rehash on login,
  constant-ish-time failure for unknown emails (dummy-hash verify), generic
  "Invalid email or password" (no enumeration).
- **JWT**: HS256 access tokens, 15-min TTL, issuer/audience pinned, `purpose`
  claim separates access vs the 5-min MFA-challenge token.
- **Refresh rotation + reuse detection**: 256-bit opaque tokens stored only as
  SHA-256 digests; every use rotates and marks the prior used; replay of a used
  token → **session revoked + `auth.refresh_reuse_detected` event**; concurrent
  rotation race resolved by a guarded `updateMany` (single winner).
- **Sessions / devices**: server-side `Session` rows (device label, IP, UA,
  lastSeen), list endpoint, per-session revoke, logout, logout-all. Access-token
  guard checks **live-session** on every request → revocation is immediate,
  not deferred to JWT expiry.
- **MFA/2FA**: TOTP (otplib, ±1 window), secret AES-256-GCM encrypted at rest,
  8 single-use recovery codes (hashed), disable requires **step-up** (password
  AND code).
- **Password reset / email verification**: 256-bit hashed single-use TTL tokens;
  reset revokes ALL sessions; requests always 202 (no enumeration); messages
  written to `EmailOutbox` seam (no fake sends).
- **Secure cookies**: refresh token in `httpOnly` `SameSite=Strict` cookie
  scoped to `/v1/auth`; `Secure` gated by `COOKIE_SECURE`; non-browser clients
  opt into body transport (`x-token-transport: body`).
- **Rate limiting**: Redis fixed-window per-IP + per-account budgets on login,
  MFA verify, refresh, reset, verification — **fail CLOSED** (503) if Redis is down.
- **Brute force**: progressive account lockout (5→1m, 8→5m, 10→15m, 15→1h),
  reset on success.
- **Audit**: `SecurityEvent` + `LoginAttempt` tables on every auth mutation;
  owner-visible login-history + security-events endpoints.
- **Error handling**: RFC 7807 problem+json filter — no stack traces, unexpected
  errors logged server-side as generic 500.

### Verification
`tsc` clean · 7 unit tests pass (crypto round-trip/tamper, lockout policy) ·
`prisma generate` + schema valid · `tsc -p build` → `dist/main.js` · env
fail-fast verified. The **13-scenario e2e suite** (`test/auth.e2e.test.ts` —
login, no-enumeration, refresh rotation + reuse revocation, sessions/revoke/
logout-all, lockout, full MFA incl. recovery-code single-use, reset+session
revocation, email verification, history/audit) runs against the real
Postgres+Redis data plane; it was **not executed in this environment** (no
container runtime; DB credential access gated here). Run it with the commands
in PROJECT_STATE.md before merge.

### Open (unchanged)
Tenancy isolation (SEC-001/DB-002) still CRITICAL-open — `User.tenantId` is a
reserved nullable column so Phase 3 is additive. RBAC (Phase 4) not yet wired;
current guard authenticates but does not yet check permissions.

---

## Phase 3+4 — Authorization foundation IMPLEMENTED (2026-08-27)

Tenancy + RBAC per ADR-0004. **SEC-001 (CRITICAL) → CLOSED.**

### SEC-001 → CLOSED — tenant isolation, server-enforced
- Active tenant is derived from the session's membership, stamped into the
  access-token `tid` claim, and re-verified against a **live membership** on
  every request (`TenantGuard`). Request body/params/query NEVER supply a
  tenant id for scoping — the "client-supplied tenant id is ignored" e2e case
  asserts a body `tenantId` cannot redirect a write.
- Data-layer choke point: scoped Prisma extension injects the context tenantId
  and **throws on unscoped access** to tenant-owned models (deny-by-default).
- Defense-in-depth: PostgreSQL RLS FORCE migration (`prisma/migrations/rls/`)
  for prod under a NOBYPASSRLS role.

### Attack coverage (the five requested), tested
| Attack | Control | Test |
|---|---|---|
| Cross-tenant access | server-derived tenant + scoped reads | e2e: each owner sees only its tenant / member list excludes other tenants |
| IDOR | unique reads wrapped in `AND tenantId` → foreign id 404s | e2e: role-assign & role-delete on another tenant's id → 404, no mutation |
| Privilege escalation | deny-by-default RBAC; custom role cannot grant beyond creator's own grants | e2e: operator can't create roles (403); admin can't grant `wallet.credit` (403); roleless member 403 everywhere |
| Unauthorized API access | JwtAuthGuard on all tenant routes | e2e: no token → 401 |
| Unauthorized UI actions | frontend gates off the same permission set (`me`/context) — server is the authority | server-side enforced; UI gating lands with the admin screens (Phase 6) |

### Controls added to the baseline (→ EXISTING)
- **Authorization**: deny-by-default `@RequirePermissions` + `PermissionGuard`;
  `resource.action` permissions with wildcard grants; route↔permission coverage
  is explicit in the controller.
- **RBAC**: seeded permission catalog + system roles (owner/admin/operator/
  auditor); tenant **custom roles**; permission **groups**; assignment via
  membership.
- **Audit**: `AuditLog` written (scoped) on every authz mutation (tenant update,
  role create/delete, membership role assignment); owner-visible `audit-logs`
  endpoint gated by `audit.read`.
- **IDOR/least privilege**: custom-role creation refuses permissions the creator
  does not itself hold (no escalation), and unknown permission keys (400).

### Verification
`tsc` clean · **26 unit tests** (authorization wildcard/deny logic, tenant-scope
injection + deny-without-context, catalog integrity incl. auditor-has-no-mutate)
· build → dist · web tests still 13/13. The **authz e2e suite**
(`test/authz.e2e.test.ts` — cross-tenant, IDOR, privilege escalation,
unauthorized access, client-tenant-id-ignored, audit) requires the seeded data
plane and was **not run here** (no DB access in this environment); run per
RUNBOOK.md.

### Open
SEC-002 (toll-fraud spec) unchanged — due with Phase 12. SEC-005 (payment
rails) unchanged. RLS is coded but enablement is a deploy step (Phase 20).

---

# Implemented controls (2026-08-29) — pre-Phase-12 hardening

What is actually in force in the code today, verified against the running
system. Supersedes the "NOT BUILT" status of the auth/authz/headers rows in
the 30-area baseline above.

## HTTP security headers

**API (NestJS/Express, JSON-only)** — `helmet` in `apps/api/src/main.ts`,
tuned for an API that renders no HTML:
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` — an API response must never load a resource, so the strictest policy is correct and cannot break anything.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, `Cross-Origin-Opener-Policy: same-origin`, `X-Powered-By` removed.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`.
- **Verified** on 200, 401 (auth) and 404 responses by `test/security-headers.e2e.test.ts` (3 tests).

**Web (Next.js)** — non-CSP headers in `apps/web/next.config.ts`
(`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` as above); CSP is per-request in `apps/web/src/middleware.ts`.

## CSP (web)

Nonce-based, **production only**, in `apps/web/src/middleware.ts`. Dev has no
CSP so Next HMR/eval keeps working.

- `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'` — **no `unsafe-eval`, no `unsafe-inline` for scripts.** Next.js stamps the nonce onto its hydration/RSC scripts; `next-themes` gets the same nonce via a prop in `layout.tsx` → `app-shell.tsx`.
- `style-src 'self' 'unsafe-inline'` — **technically necessary**: Radix UI writes inline `style` attributes that cannot carry a nonce. Accepted: style-injection is far lower risk than script.
- `default-src 'self'`, `img-src 'self' data:`, `font-src 'self'` (fonts self-hosted via `next/font`), `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `frame-src 'none'`, `form-action 'self'`, `worker-src 'self'`, `manifest-src 'self'`, `upgrade-insecure-requests`.
- **Verified against the running production build**: all script tags nonced (11/11), the `next-themes` inline script executed (`data-theme` applied), React hydrated, **zero console CSP violations**.
- **Follow-up (next phase):** when the auth frontend calls the API on another origin, add that origin to `connect-src` in the middleware.

## HSTS

**Production only, at every layer that terminates TLS, but authored to avoid
conflict:**
- API: `helmet` emits `Strict-Transport-Security: max-age=31536000; includeSubDomains` only when `NODE_ENV=production` (off in dev/test — verified by the header test).
- Web: `next.config.ts` emits the same header only when `NODE_ENV=production`.
- **Responsibility & deployment requirement:** the **edge (Cloudflare / reverse proxy) is the canonical HSTS authority** for `portal.telvyn.co`. The app-level HSTS is a defensive fallback for direct-origin traffic; keep `max-age` and `includeSubDomains` consistent across edge and app. `preload` is intentionally OFF until the domain is committed to HTTPS-only (enabling preload is a one-way door). Local HTTP dev is never pinned (prod-gated).

## PostgreSQL RLS — DEFERRED (see ADR-0005)

RLS is **not operative**, by explicit decision (**ADR-0005**). The app-layer
scoped Prisma client is the sufficient, tested isolation control at this stage.
Blockers: (1) app runs as the table-owner role, not a dedicated `NOBYPASSRLS`
role; (2) per-transaction `SET LOCAL app.tenant_id` wiring is a real data-layer
refactor under Prisma pooling; (3) system/admin/worker cross-tenant paths are
undesigned (none exist yet). `enable-rls.sql` is the staged artifact; a 5-step
activation plan is in ADR-0005, to revisit before multi-worker / prod launch.
**RLS is defense-in-depth and never replaces application authorization.**

## Authentication frontend — INCOMPLETE (next phase)

Not built in this hardening pass by design. The web app is a static shell with
**zero backend calls** and an honest `session.user = null` seam
(`apps/web/src/lib/shell-config.ts`) — **no fake auth, no client-stored
tokens**. Required frontend work (its own phase): login form → API `/v1/auth/login`,
MFA challenge/verify UI, session restoration (silent refresh via the httpOnly
cookie), logout / logout-all, session & device management screens, password
reset + email verification flows, tenant selection (from memberships), and an
RBAC/permission context to gate UI actions (backend enforcement already exists
and remains the source of truth — UI gating is convenience only).

## Security assumptions & deployment requirements

- **TLS terminates at the edge**; the API and web run behind it. HSTS is owned
  at the edge (app fallback only). Set `COOKIE_SECURE=true` in production so the
  refresh cookie carries `Secure`.
- **CORS** is locked to `WEB_ORIGIN`; set it to the real portal origin in prod.
- Secrets come from the environment / a secret manager — never git; `.env` is
  gitignored and untracked. `JWT_ACCESS_SECRET` and `APP_ENCRYPTION_KEY` must be
  strong per-environment values.
- The CSP `connect-src` and (future) WebRTC `Permissions-Policy: microphone`
  must be revisited when the auth frontend and the telecom softphone land.

## Carrier + credential security (Phase 12E, 2026-08-29)

- **Dual-nature isolation (ADR-0008):** carrier scope is server-derived; a
  tenant cannot read/update/delete/enumerate another tenant's carrier (IDOR →
  404) nor mutate a system carrier (403), nor escalate its own carrier's scope
  (client `tenantId`/`scope`/`system` fields are stripped by the Zod DTO —
  mass-assignment safe). e2e-proven.
- **Credential secrecy (ADR-0009):** the encrypted secret (`secretEnc`) is never
  selected into a carrier query (explicit credential `select` omits it) and
  never appears in any response, list, audit metadata, or error. Cross-tenant
  credential attachment → 404; tenant attaching a system credential → 403.
  e2e assertions verify the secret string is absent from responses and audit.
- Decryption is isolated to `revealForAdapter` (adapter boundary only); secrets
  are not cached in Redis or long-lived memory.

## SIP trunk security (Phase 12F, 2026-08-29)

- **Tenant isolation:** trunks are auto-scoped (`TENANT_SCOPED_MODELS`); B cannot
  read/update/delete/enumerate A's trunk (IDOR → 404). e2e-proven.
- **Mass assignment:** client `tenantId`/`scope`/`deletedAt` are stripped by the
  Zod DTO — ownership/scope immutable; no tenant/system escalation.
- **Carrier/credential authorization:** carrier must be caller-accessible;
  credential ownership + SIP_PASSWORD type enforced; secret never returned/logged/
  audited (verified absent in responses + audit).
- **SSRF/CRLF input hardening:** SIP host/URI reject control chars, CRLF/header
  injection, whitespace, and non-`sip(s):` schemes. **12F makes no outbound
  connections**; future probing requires egress allowlisting + private-network/
  DNS-rebinding protection (documented boundary in TELECOM.md).

## DID security (Phase 12G, 2026-08-29)

- **Tenant isolation:** DIDs are auto-scoped (`TENANT_SCOPED_MODELS`); B cannot
  read/update/delete/enumerate A's DID (IDOR → 404). e2e-proven.
- **Mass assignment:** create strips unknown keys (client `tenantId`/`scope`
  ignored → owned by ctx); update DTO is `.strict()` (unknown ownership key →
  400). Number + ownership immutable.
- **Relationship injection:** a DID cannot reference another tenant's carrier/
  trunk/routing-profile, a deleted relation, or an inconsistent carrier/trunk
  pair — all rejected server-side (400). Credentials are never reachable via DID.
- **RBAC:** reuses existing `did.read` (read) + `did.manage` (create/update/
  delete). Operator (no `did.manage`) is denied create (403).

## Routing profile security (Phase 12H, 2026-08-29)

- **Tenant isolation:** profiles auto-scoped; B cannot read/update/delete/
  enumerate A's profile (IDOR → 404). Mass assignment blocked (create strips
  unknowns; update DTO `.strict()`).
- **Destination validation:** typed + per-type validated; **webhook targets are
  SSRF-validated config** (https only, public host — private/loopback/link-local/
  multicast + credentials-in-URL + control chars rejected) and **never fetched**
  in 12H. Foreign carrier/trunk references rejected (400).
- **Bounds:** priority/retry/timeout bounded; schedule timezone IANA-validated;
  no scripting/executable config (declarative only). No runtime requests during
  CRUD.

## Routing policy security (Phase 12I, 2026-08-29)

- **Loop protection:** self-failover rejected (incl. normalized phone numbers);
  `maxAttempts` + retry counts bounded → no unbounded/infinite retry config.
- **Typed failover** validated per type (webhook failover still SSRF-validated;
  never called). Oversized-config bounds (≤100 rules, ≤5 conditions, string/int
  caps). `failoverEnabled` requires ≥1 condition.
- **Atomic optimistic-concurrency updates** (`version` + `expectedVersion` → 409)
  prevent lost-update races; rule replacement is all-or-nothing. Mass-assignment
  unchanged (create strips unknowns, update `.strict()`). No runtime calls in CRUD.

## LCR security (Phase 12J, 2026-08-29)

- **Tenant isolation:** LCR policies auto-scoped; B cannot read/update/delete/
  enumerate A's policy (404); a route cannot reference a foreign carrier/trunk
  (400). Mass assignment blocked (create strips unknowns; update `.strict()`).
- **Cost safety:** integer micro-units (no float/NaN/Infinity), non-negative,
  bounded. No billing/charging performed. No secrets in LCR (carrier/trunk are
  id references; responses assert no `secretEnc`/password).
- **Atomic optimistic-concurrency updates** (`version`/`expectedVersion` → 409);
  route replacement all-or-nothing. Deterministic ordering (no incidental order).
  No runtime network calls in CRUD.
