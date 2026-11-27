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
  AND code). **TOTP replay guard (Phase 13-2B S1, BA-15):** each user's last
  accepted time step is stored; a code is accepted only for a later step, so a
  TOTP code works at most once (concurrency-safe conditional update).
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

## Engine foundation security (Phase 12K, 2026-09-01)

- **No secret exposure.** The `EngineConfigurationIntent` fed to adapters carries
  credentials only as a `credentialRef` id — never a plaintext secret, encrypted
  blob, or `secretEnc`. Secrets stay in the vault (ADR-0009); nothing in 12K reads
  or persists them. Status/sync responses, audit metadata, and log lines are all
  asserted secret-free (e2e greps responses for `secret|password`).
- **No secret/error leakage in logs or errors.** `EngineService.normalizeError`
  suppresses unknown-error detail (returns a fixed `"engine operation failed"`),
  so engine-internal exception text can never reach a controller or client.
  Structured logs emit only provider/engineId/operation/correlationId/duration/
  outcome/code — no payloads.
- **No SSRF / injection / arbitrary code paths.** Adapters are resolved **only**
  through `EngineRegistryService`'s static type→class map; unsupported providers
  are rejected and tenant-controlled class/module names are impossible (no dynamic
  instantiation). No tenant-supplied engine endpoints/URLs exist — sync targets a
  registered platform engine, not an arbitrary host. No command execution, no
  outbound network calls (adapters are stubs).
- **Bounded resource use.** Every adapter call runs under a timeout guard (default
  5 s, hard cap 30 s) via `Promise.race` — never infinite wait, never unbounded
  retry. A hung probe degrades to honest `UNKNOWN`, not a hang.
- **Honest health + honest failure.** Health is `UNKNOWN` for stubs (never fake
  `HEALTHY`); `sync` returns HTTP 501 `NOT_IMPLEMENTED` rather than fabricating
  success.
- **Platform-only + audited.** Both endpoints sit behind `PlatformGuard` +
  permission gates (`telecom.health.read` / `telecom.manage`); a customer tenant
  is 403 even as owner, unauthenticated is 401. Every sync attempt is audited
  (`telecom.engine.sync_attempted`) with a correlation id.

## Engine runtime integration security (Phase 12L, 2026-09-01)

Phase 12L builds the runtime *integration boundary*. No live SIP/RTP and **no
network egress** occur (the wired connector is the honest `NullEngineConnector`),
but the security controls are real and tested.

- **Canonical SSRF egress policy** (`engine-endpoint.ts`) — the single authority
  for validating a management endpoint before any egress. Requires an explicit
  `http`/`https` scheme, forbids credentials-in-URL and control/CRLF characters,
  and permits only a **public host**: blocks `localhost`/`*.local`/`*.internal`,
  loopback (`127/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT
  (`100.64/10`), link-local (`169.254/16` incl. **cloud metadata**, `fe80::/10`),
  unique-local (`fc00::/7`), multicast/reserved, `0.0.0.0/8`, **IPv4-mapped &
  NAT64 IPv6**, and **alternate IP representations** (decimal/octal/hex). A
  connect-time `assertResolvedIpAllowed` re-checks the DNS-resolved IP
  (**rebinding defence**). Endpoints are **platform-configured only** (PlatformGuard),
  never tenant input; the policy is enforced both at config time (engine
  create/update → 400) and pre-connect. This is the canonical *egress* policy —
  distinct from the 12H webhook check (a config-time gate for never-called URLs).
- **No command / dialplan / XML injection.** Providers are driven by typed
  operations only (`healthCheck`, `applyConfiguration`, future `reload`) — never
  `execute(userCommand)`, raw ESL/AMI, or user-supplied dialplan/XML/Lua. No shell
  execution; no `exec`/`spawn` on untrusted input.
- **Secret-safe.** The desired-config fingerprint is computed over the secret-free
  `EngineConfigurationIntent` (credentials are `credentialRef` ids); version
  snapshots (`TelecomConfigVersion`), health events, logs, and audit metadata are
  all secret-free (e2e greps responses/audit for `secret|password`). The vault is
  never read into a response.
- **Bounded + fail-closed.** Bounded connect/request/operation timeouts and
  bounded retry/backoff (centralized per provider); the Redis sync mutex
  (`SET NX`) fails closed — Redis down → sync refused (503), never a double-apply.
  Concurrent sync → 409.
- **Honest.** Reachability that is unproven → `UNKNOWN` (never fabricated
  `HEALTHY`); sync → `501 NOT_IMPLEMENTED` (never fake success); `appliedVersion`
  stays `null` because nothing is applied.
- **IDOR/BOLA-safe + audited.** All runtime endpoints are PlatformGuard + permission
  gated (customer 403, unauth 401, nonexistent 404); health-check / sync / rollback
  attempts are audited with correlation ids and secret-free metadata.

## Engine private-network management allowlist (Phase 12M-2, 2026-11-17)

A real engine management plane is reached over a PRIVATE transport (a WireGuard
address behind an mTLS gateway), which the canonical policy above denies by
default. Phase 12M-2 adds a **narrow, explicit allowlist** that authorizes a
specific private IP + port **individually** — it narrows, never widens, egress.

- **Address-only, never a name.** An entry matches on the IP address, so a
  hostname can never be allowlisted — defeating DNS-rebinding to an arbitrary
  address. Forbidden hostnames (`localhost`, `*.internal`, …) stay forbidden
  regardless of the allowlist.
- **No blanket RFC1918.** IPv4 entries must be `/24..32` (a blanket `10/8`,
  `172.16/12`, `192.168/16` is rejected); IPv6 entries must be an exact address
  (`/128`). A port is **mandatory** per entry — an allowlisted host is reachable
  only on its declared port(s).
- **Same allowlist at config AND connect time.** `parseEngineEndpoint` (engine
  create/update) and `assertResolvedIpAllowed` (connect-time, post-DNS) consult
  the same allowlist, so a resolved IP that is private-but-not-allowlisted — or
  allowlisted-but-on-the-wrong-port — is still refused.
- **Platform-only, fail-closed source.** The allowlist comes from the platform
  env `ENGINE_MGMT_ALLOWLIST` (comma-separated `CIDR@port[;port…]`, e.g.
  `10.9.0.1/32@8443`) — never tenant input. Malformed tokens are dropped
  (fail-closed → that endpoint stays blocked). **Unset (the default) = empty
  allowlist = the strict public-only policy, unchanged.** No egress occurs yet;
  the wired connector is still `NullEngineConnector`.

## Real Kamailio management connector (Phase 12M-3, 2026-11-17)

Phase 12M-3 adds the first real engine connector — a **read-only JSONRPC health
probe** (`core.version`) over the private mTLS gateway. It remains **off by
default**; nothing changes until the platform opts in.

- **Default off, env-gated.** `ENGINE_CONNECTOR` unset (or anything other than
  `kamailio`) → `NullEngineConnector` (no egress). `kamailio` → the real connector
  — and even then nothing is contacted until an engine has an allowlisted
  management endpoint AND an `ENGINE_API` credential. Flipping the flag alone
  changes no behavior.
- **Single network seam.** All egress goes through one injectable transport
  (`EngineHttpTransport`); connector logic is unit-tested with a mocked transport
  (no live egress). The real `NodeHttpsEngineTransport` enforces **https + mTLS**
  (client cert presented, server cert verified `rejectUnauthorized: true`), a
  **connect-time rebinding recheck** (the same `assertResolvedIpAllowed` + allowlist,
  per resolved IP + port), **bounded** connect/request timeouts, and a **capped**
  response body.
- **Secret at the boundary only.** The mTLS client cert is a vault `ENGINE_API`
  credential, decrypted solely via `revealForAdapter` inside the connector, never
  cached, logged, or returned. A wrong-type or malformed credential → honest
  `UNKNOWN` (no egress). Proven in tests: the key body never appears in any `detail`.
- **Honest health.** Valid `core.version` → `HEALTHY`; the engine answered but not
  OK (non-2xx / JSONRPC error / no version) → `UNHEALTHY`; unreachable / unverifiable
  → `UNKNOWN` — never a fabricated `HEALTHY`. Transport failures map to a fixed,
  safe vocabulary (`connection refused`, `timed out`, `TLS verification failed`,
  `blocked by egress policy`) — raw provider/TLS text is never surfaced.
- **Scope.** Kamailio is a SIP router (`originate:false`); this connector is
  read-only health introspection. Pushing configuration is a separate later
  concern (no engine↔resource model yet) and is not done here.

## Live management plane validation (Phase 12M-4, 2026-11-17)

The connector was proven end-to-end against a disposable Kamailio 6.1.5 test
engine with the real transport — no mocks — confirming the security envelope
holds on the wire:

- **Private transport, SIP closed.** Management reaches Kamailio only via
  WireGuard (`10.9.0.1`) → nginx **mTLS gateway** (`wg0:8443`, `ssl_verify_client
  on`) → Kamailio JSONRPC on loopback (`127.0.0.1:8000`, source-restricted to
  `127.0.0.1`, path `^/RPC`). SIP/RTP remain closed; the public interface exposes
  only SSH + WireGuard. Kamailio runs a management-only config (no public SIP).
- **mTLS, both directions.** nginx presents a CA-signed server cert (SAN
  `IP:10.9.0.1`, which the connector verifies) and requires a client cert; the
  client cert is the vault `ENGINE_API` credential. The client **private key was
  generated on the control-plane host and never left it** (only its CSR went to
  the VPS CA) — it never transited any chat or the VPS.
- **Allowlisted egress.** The connector reaches the private IP only because
  `ENGINE_MGMT_ALLOWLIST=10.9.0.1/32@8443` authorizes that exact IP+port; the
  connect-time rebinding recheck re-validates the resolved IP. Result: honest
  `HEALTHY` from a real `core.version`.
- **Dev-host caveat (not a product control).** The control-plane host for this
  test is a Windows dev box; a MITM antivirus there (AVG Web/Mail Shield) will
  intercept TLS and present its own cert (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`),
  which the connector correctly REFUSES — the strict `rejectUnauthorized` did its
  job. A production control-plane host has no such interception. See RUNBOOK.md.

## Engine config apply — htable diff-and-apply (Phase 12N-4b, ADR-0013)

The first operation that **changes engine state**. It mutates ONLY the dedicated
`telvyn` in-memory htable via typed JSON-RPC, never config/modules/routing.

- **Scoped to one htable.** The table name is a constant (`telvyn`); no RPC ever
  names another table. Stale-key deletion is restricted to **managed** keys
  (`did:`/`trunk:`/`route:`) — a foreign key in the table is never deleted.
- **Strict validation, no injection.** Keys are namespaced + non-numeric (so
  Kamailio can't reinterpret them as integer indices), length-bounded, control/CRLF
  rejected; values derive ONLY from safe fields (ids, validated E.164, enum, int) —
  never tenant free-text. A malformed desired set is rejected **whole, before any
  egress** (`INVALID_CONFIG`) — never a partial/sanitized push. Entry count is bounded.
- **Typed operations only.** `htable.dump`/`htable.sets`/`htable.delete` — no
  `execute`, no shell, no generated config blob, no arbitrary RPC method from input.
- **Verified or not applied.** After the bounded sets/deletes, a **re-dump** must
  equal the desired set or the result is `APPLY_INCOMPLETE` (never success). A
  **timeout** → `PENDING_RECONCILIATION` (12N-4a), applied version never advanced;
  the idempotent next apply re-diffs and reconciles.
- **Same transport envelope.** Goes through the connector over mTLS (server cert
  verified) + the connect-time rebinding recheck + bounded timeouts; the credential
  is revealed only at the boundary and never logged. Concurrency is still guarded by
  the Redis `SET NX` sync mutex. Audit carries `syncState` + correlation id, no payloads.
- **Off by default.** Production DI stays `NullEngineConnector` (NOT_IMPLEMENTED).
  The real apply engages only with `ENGINE_CONNECTOR=kamailio` + an allowlisted
  endpoint + an `ENGINE_API` credential, and the live mutation is operator-gated.

## Auth frontend security (Phase 12O-2c, 2026-11-18, ADR-0016)

The frontend sign-in flow against the existing `/v1/auth/*` endpoints. The
backend auth model (argon2id, short access token + rotating refresh with reuse
detection, server-revocable sessions, TOTP MFA) is unchanged — this is the
browser side only.

- **No token in JS-readable storage.** The short-lived access token lives only
  in memory (a module closure); it is never written to localStorage /
  sessionStorage / IndexedDB, so an XSS payload cannot exfiltrate it. The
  long-lived rotating refresh token is an httpOnly cookie the browser holds and
  JS cannot read; `credentials:"include"` carries it and we never send
  `x-token-transport: body`, so the refresh token never enters JS.
- **Reload survival via the cookie, not storage.** On load the client exchanges
  the refresh cookie at `/v1/auth/refresh` for a fresh access token. A full-page
  reload clears the in-memory token by design; the cookie re-bootstraps it.
- **Server stays the authority.** The `<AuthBoundary>` gate and the session
  context are UX only (what to render). Every API route keeps its own
  authentication + permission + platform checks; the frontend never makes an
  authorization decision. Permission checks are exact-match over the
  server-expanded set.
- **CSP.** Production `connect-src` is `'self'` plus the API origin, derived from
  `NEXT_PUBLIC_API_URL` so policy and client cannot drift; unset or same-origin
  collapses to `'self'`. No other CSP relaxation; `script-src` stays nonce-locked
  with `'strict-dynamic'`, no `unsafe-eval`.
- **No secrets in logs / URLs.** Credentials and MFA codes are sent only in POST
  bodies over the client; errors surface the RFC 7807 `title`/`detail`, never
  tokens. Sign-out revokes the server session (`/v1/auth/logout`) and clears the
  in-memory token.
- **No backend change.** No API, schema, DI-default, or auth-behavior change;
  production DI stays `NullEngineConnector`.

### Password reset + email verification (Phase 12O-2d, ADR-0016 addendum)

- **No account enumeration.** The reset-request UI always reports the same
  "if an account exists…" outcome (the endpoint is a fixed 202); the frontend
  never branches on existence.
- **Public routes are bare and isolated.** `/reset-password` and `/verify-email`
  render outside the session provider, the gate, and the shell (decided in
  `AppProviders`), so a token link exposes nothing of the authenticated app and
  fires no session calls. They read their one-time token only from the URL and
  send it only in a POST body.
- **Tokens, not sessions.** Reset/verify use short single-purpose tokens; a
  successful reset revokes all of the user's sessions server-side. No password
  or token is logged; errors surface the RFC 7807 title only.
- Server remains the authority on token validity, expiry, and rate limiting
  (login-ip / reset / verify limiters unchanged). No backend change.

### Permission-aware nav + route gating (Phase 12O-2e, ADR-0017)

- **Frontend gating is UX, never authorization.** The nav filter
  (`useVisibleNavItems`) and the route gate (`RouteGuard`) only decide what to
  render, from the session's expanded permission set. Every API route keeps its
  own permission + platform checks, so a hidden link, a hand-typed URL, or a
  tampered client exposes no data — the API refuses the call regardless.
- **Deny-by-default UX.** A module shows only when the session holds its
  permission key (from the server catalog); unknown/missing permission → the
  "Access restricted" state, not the page. The Operations landing is the one
  unguarded route so every member has a home.
- **No secret in the gate.** The gate compares plain permission keys already
  expanded server-side; it never sees roles' internals or any secret. No
  backend/API/schema/DI change.

### NOC read pages — platform gating + safe DTOs (Phase 12O-2f, ADR-0018)

- **Platform-only, UX + server.** The NOC ("Infrastructure") nav item and route
  require the platform tenant (`platform` flag) on top of `telecom.read`; the API
  enforces the same with PlatformGuard on every telecom controller. The frontend
  gate only hides/blocks the view — a non-platform member who hand-types the URL
  gets the API's 403, not data.
- **No secrets in the engine DTO.** The contracted `Engine` shape exposes
  `credentialId` as a vault reference only (never the secret) and `endpoint` as a
  management host reference (never a credential). Health is honest `UNKNOWN` for
  stub adapters — never fabricated.

### NOC mutating actions (Phase 12O-2i, ADR-0019)

- **Gated, confirmed, non-retrying.** The engine actions show per permission
  (Check-health → `telecom.health.read`; Sync/Rollback → `telecom.manage`); the
  server (PlatformGuard + permission) re-checks every call, so a visible button
  never implies authorization. Sync and rollback — state-changing — require a
  confirm dialog. Mutations go through the client, which **never auto-retries**,
  so a failed or ambiguous sync is never silently replayed (double-apply risk).
- **Honest outcomes.** The `501 NOT_IMPLEMENTED` returned by the Null connector
  is shown as the honest result it is, not a fabricated success. No secrets in
  the `SyncOutcome` / `EngineHealthReport` (versions are short fingerprints,
  details are safe reasons). No backend/API/schema/DI change.

## Node heartbeat ingest (Phase 12O-2ba, ADR-0020 slice 2)

The node liveness heartbeat is a **machine** ingest endpoint
(`POST /v1/telecom/nodes/:id/heartbeat`), outside the human auth model. Its
security posture:

- **mTLS-only, via a single seam, fail-closed.** Authentication is the node's
  `NODE_AGENT` mTLS client certificate, resolved by one `HeartbeatAuthenticator`
  abstraction — the inbound analogue of ADR-0011's `EngineConnector`. The seam
  **never** derives identity from a spoofable header or body field. The default
  `NullHeartbeatAuthenticator` produces no identity, so **every beat is rejected
  (401) today** — there is no inbound mTLS terminator in the environment yet (the
  app is a plain-HTTP JSON API behind a TLS-terminating proxy; the only mTLS is the
  OUTBOUND engine gateway). We do not pretend to have verified a certificate we
  never saw. A real terminator (app-terminated TLS socket, or a trusted gateway
  that forwards a verified fingerprint over an isolated path) is a drop-in.
- **Identity-bound (no cross-node forgery).** A verified fingerprint is accepted
  only if it equals the fingerprint stored (non-secret) on the node's `NODE_AGENT`
  credential; a node can report only its own health. No credential / wrong type /
  mismatch → 403. The node is looked up **only after** authentication, so an
  unauthenticated caller gets no node-existence oracle (401 regardless).
- **Rate-limited, fail-closed.** Per-node fixed window (`node-heartbeat` bucket);
  a Redis outage refuses the beat (503), never silently allows it.
- **No privilege, no state transition, no secret.** An accepted beat stamps
  `lastHeartbeatAt` only — it grants nothing and changes no health status (the
  dead-man's-switch evaluator owns transitions, slice 3). The payload is non-secret
  liveness (version/uptime) only.
- **Not in the audit log.** The audit log is an actor/tenant (human) record; a 30s
  machine beat has no honest actor and would firehose the OLTP audit table
  (ADR-0010). Accept/reject go to the structured logger (nodeId + correlation id),
  the same observability path as engine/node health.

## Node health evaluator — dead-man's-switch (Phase 12O-2bb, ADR-0020 slice 3)

The periodic evaluator that turns heartbeats into honest health:

- **Platform-gated action.** `POST /v1/telecom/nodes/health/evaluate` is PLATFORM +
  `telecom.manage`; a non-platform or under-permissioned caller gets 403. It is
  triggered by a platform operator or a dedicated external cron with platform
  credentials — not a public or node-facing endpoint.
- **Multi-instance safe, fail-closed.** A Redis `SET NX` lock ensures only one tick
  evaluates at a time across a horizontally-scaled fleet; if the lock is held or
  Redis is unavailable the tick is **skipped** (never a racing double-write of a
  transition), and the next tick retries. Same fail-closed posture as the engine
  sync lock.
- **Honest, bounded, caps at UNKNOWN.** Only genuine status changes are written, as
  append-only `HealthEvent` rows (the durable record); silence yields `UNKNOWN`,
  never a fabricated `DEGRADED`/`UNHEALTHY`. Idle ticks are logged, not audited; a
  tick that transitioned ≥1 node writes one bounded audit row — a ~90s cadence is
  never allowed to firehose the OLTP audit table (ADR-0010).

## Node-agent credential provisioning (Phase 12O-2bc, ADR-0020)

Attaching a node's heartbeat identity (`POST /v1/telecom/nodes/:id/credential`):

- **Private key never leaves the node.** The admin submits only the node's PUBLIC
  client certificate; the server derives the SHA-256 fingerprint and vaults the
  cert. There is no key generation or private-key handoff — the node keeps its key.
  The fingerprint (the heartbeat matcher) is non-secret and surfaced as the
  credential `hint`; the cert PEM is vaulted and never returned (`Node.credential`
  is a safe reference only).
- **Platform-gated.** PLATFORM + `telecom.manage`; nodes are platform-global, so the
  credential is a system (null-tenant) vault entry. A non-platform/under-permissioned
  caller gets 403.
- **Rotation is clean.** Re-attaching replaces the identity and soft-deletes the
  prior node-agent credential, so a node has exactly one active identity; detach
  soft-deletes it. Audited (`telecom.node.credential_attached` / `_detached`), no
  secret in the audit metadata (only the credentialId + non-secret fingerprint).
- **Closes the gap, not the terminator.** This makes a node's expected fingerprint
  known, so the heartbeat authenticator can bind a verified cert to the node — but
  acceptance still requires a real inbound mTLS terminator (none is deployed yet),
  so the ingest remains fail-closed until then.

## Financial authorization foundation — EXISTING (Phase 13-2B S1, 2026-11-26; merged PR #28)

ADR-0022 Amendment 5 BA-08/BA-15; owner decisions G1–G4. Merged to `main`; NOT deployed.

- **Wildcard exclusion:** a catalog permission flagged `wildcardExcluded` (high-risk financial authority)
  is never covered by `*` or `x.*` in `grantCovers`/`isAuthorized`, and is never materialized by
  `expandGrants` (seed and runtime) — only an explicit grant satisfies it. **No key is flagged in S1**
  (owner decision G3: the first is named in S5), so today's effective permissions are unchanged apart from
  the retired `wallet.credit`.
- **MFA-for-finance:** `TenantGuard` drops wildcard-excluded keys from the effective permission set of a
  user without MFA (fail closed).
- **Assignment fails closed (G4):** creating a custom role, or assigning roles to a member, that would
  confer a wildcard-excluded key is refused (403). The governed path (step-up, no self-assignment,
  same-transaction financial audit) is S2/S5 work.
- **`wallet.credit` retired** (catalog + stored rows); guarded by tests against reintroduction.
- **Server-side step-up (`StepUpService`, inert):** `issue` needs a fresh TOTP code (recovery codes are
  NOT accepted for financial step-up — an S1 implementation choice, **pending owner ratification before S5**; the replay guard applies), an ACTIVE user with MFA, a live session of
  that user whose active tenant is the bound tenant, and an ACTIVE membership in an ACTIVE tenant; it
  records a grant valid **300 s** (G1). `consume` single-uses it in one `UPDATE` that re-checks user,
  session, tenant, purpose, strict expiry, session liveness, user status and MFA, and can run inside the
  caller's transaction. Failures return a generic reason (no detail leak). No controller exposes it; no
  operation requires it yet (first: S5 provisioning).
- **Not in S1:** maker-checker (13-3/13-4 money operations), dual-control thresholds (open), the financial
  audit table and its write (S2), private ledger-context minting (S7), service identities for step-up-free
  flows. **Pre-existing, out of scope:** `setMemberRoles` lets any `member.manage` holder assign any role
  in the tenant, including `owner` (`*`); wildcard exclusion now keeps high-risk financial keys out of that
  path, but general role-escalation hardening needs its own decision.
  **This gap is a blocking security gate before S5 and before any financial permission grant** (recorded
  2026-11-27, S2 review); it is not fixed in S2.

## Financial audit foundation — MERGED, INERT (Phase 13-2B S2, 2026-11-27; PR #31)

ADR-0022 Amendment 5 BA-14; owner decisions F1–F7. A foundation only — NOT deployed and NOT active commercial billing.

- **Separate from other audit planes:** `FinancialAuditEvent` records financial state changes; `AuditLog`
  (operational events), `SecurityEvent`/`LoginAttempt` (authentication) and the ledger (money history) are
  unchanged. An audit row is never a ledger entry and never commercial authorization.
- **Same transaction, fail closed:** `FinancialAuditWriter.record(tx, actor, event)` holds no database client
  of its own; it refuses a base client (anything exposing `$transaction`), opens no nested transaction, never
  retries and never swallows an error. Audit failure rolls the change back; a later failure rolls the audit
  row back. A rolled-back transaction leaves no audit row — denied-attempt recording (own transaction) is S5 (F2).
- **Attribution:** the actor comes only from the server-derived `TenantContext` (the event input has no actor
  field); human actors only (F3). A non-platform actor can only audit its own tenant (writer + DB FA004); a
  cited step-up grant must be the actor's (FA005); a cross-tenant BillingAccount reference is impossible
  (composite FK).
- **Metadata:** plain objects, ≤ 4096 bytes / ≤ 50 keys (writer and DB). A recursive denylist of sensitive key
  names (password, secret, token, TOTP/OTP/MFA, recovery, credential, CVV/CVC, PAN/card number, connection
  string/DSN/database URL, API/private/access keys) rejects the whole event; errors never echo submitted
  values. Raw step-up evidence is never stored — only the grant id. No free-text reason.
- **Immutability:** runtime SELECT + INSERT only; UPDATE/DELETE/TRUNCATE refused by privilege (42501) and, for
  the owner, by the guard triggers (FA001–FA003). Not claimed against superusers or an owner disabling triggers.
- **Inert:** the operation catalog is empty (F1); only `BillingModule` imports the writer (unit-tested); no
  endpoint, caller, audit read API or financial grant exists.
- **Open:** retention policy for stored IP address / user agent (append-only rows keep them indefinitely);
  idempotency-key format and replay audit suppression (S5); audit read projections (S8).

## Chart of Accounts foundation — IMPLEMENTED, INERT (Phase 13-2B S4, 2026-11-28)

ADR-0022 Amendment 5 BA-10; owner decisions D1–D6. NOT deployed and NOT active commercial billing.

- **No runtime path:** `telvyn_app` cannot execute `billing.ledger_account_open` and holds no LedgerAccount
  privilege (42501, asserted by `ci-privilege-check.sql`); PUBLIC EXECUTE revoked. No endpoint or caller.
- **Definer hardening:** SECURITY DEFINER owned by the NOLOGIN `telvyn_ledger_fn`, fixed `search_path`,
  schema-qualified references, no dynamic SQL (drift-checked). Platform authority is read from the trusted
  session context (`app.is_platform`); caller-supplied tenant and currency are only expectations checked
  against the locked BillingAccount. Not-found and other-tenant accounts share one sanitized error (LA001)
  — no tenant enumeration; messages carry no identifiers.
- **Least privilege:** the function owner gains column-scoped INSERT on LedgerAccount, column SELECT on
  BillingAccount and the lock-only UPDATE(`statusChangedAt`); no table-level INSERT/UPDATE/DELETE. Impact
  on `billing.ledger_post` reviewed: none (its fixed body never uses them).
- **Database-enforced:** same tenant and currency (composite FK), immutable link (LA006), approved
  taxonomy/code/type/normal balance (CHECK + trigger), reserved prefix, uniqueness (index) and RESTRICT
  deletes hold for direct writes by the table owner too. Not claimed against a superuser or an owner who
  disables triggers.
- **Concurrency:** the BillingAccount row lock serializes opens and status changes; E2E proves a waiting
  open sees a committed suspension (LA003) and concurrent duplicates yield exactly one account (LA005).
- **Open before S5:** lock timeout/retry values (S6); the runtime EXECUTE grant, authorization, step-up and
  same-transaction financial audit of the opening (S5).

## QA-LEASE-001 — E2E run-lease false detection (OPEN, reliability)

- **Evidence (EXECUTED/OBSERVED, `local-verify`, 2026-11-27/28):** 5 full E2E attempts — 3 passed, 2 aborted
  with "exclusive run lease LOST (lock not held by this run)". In 3 probed runs a read-only poll of
  `pg_stat_activity`/`pg_locks` (~2 s interval) saw one lease session per run, and **no sample** in which that
  session existed without its advisory lock; in the failed probed run the same session (same pid and
  backend start) held the lock until the run ended — after the client reported the loss.
- **Assessment:** suggests a **false detection** (the heartbeat query evaluated false although the lock was
  held), most likely by running on a different backend than the lease session. That connection-switch
  hypothesis is **unconfirmed**; sampling gaps of up to ~5 s mean a short-lived second session could have
  been missed, so the root cause is not conclusively established. The guard failed closed both times.
- **Residual risk:** reliability (unattended runs abort); a false-positive *safety* outcome is not shown to be
  impossible and is not claimed so.
- **Follow-up (separate task, not S4):** diagnostics only — log the heartbeat's backend PID and the observed
  lock-owner PID on every negative result. The lease guard is not weakened or bypassed.

## E2E target safety — MERGED (INC-DB-001B, 2026-11-27; PR #29)

Corrective controls for incident INC-DB-001 (`docs/incidents/INC-DB-001.md`). This is a
safety interlock against configuration mistakes, **not** a security boundary against a
privileged or malicious operator.

- **Unit-only default lane:** `vitest.config.ts` includes only `src/**/*.test.ts` and
  `test/**/*.unit.test.ts`, and excludes every `*.e2e.test.ts`. `test/setup-unit.ts`
  pins `DATABASE_URL` / `REDIS_URL` to unresolvable `.invalid` sentinels, so neither
  Prisma's `.env` auto-load nor `dotenv/config` can supply a real target. `pnpm test`
  is this lane; `pnpm test:e2e` is the only E2E lane.
- **Gate A (pre-connection, pure):** `test/e2e-target-guard.ts` `validateGateA`.
  - Requires `TELVYN_E2E_PROFILE` (`local-isolated` | `local-verify` | `ci-ephemeral`;
    no default, no automatic selection). Each profile pins fixed hosts, ports, database,
    roles and Redis DB; there is no host/port/database override and no wildcard name.
  - `local-verify` (INC-DB-001B-PRE2): `127.0.0.1:5435` / `telvyn_safety_verify`,
    Redis `127.0.0.1:6382` DB 0, marker `telvyn-inc-db-001b-local-verify` — the
    dedicated disposable verification environment (`docs/DEVOPS.md`).
  - Validates `DATABASE_URL`, `E2E_FIXTURE_DATABASE_URL` and `REDIS_URL` for URL
    syntax, protocol, host allowlist, explicit *published* port, database name,
    expected role (`telvyn_app` / `telvyn_migrator`), Redis logical DB, and the
    query parameters allowed. A URL fragment or a repeated query parameter is refused
    (`BAD_QUERY`, review L1).
  - Protected ports 5432/5433/6379/6380 are refused in **every** profile.
  - The retired `TELVYN_E2E_ALLOW_TARGET` is refused outright.
  - `ci-ephemeral` additionally requires `GITHUB_ACTIONS=true` and `CI=true`, and
    still names no protected port.
- **Gate B (post-connection identity, read-only):** `test/e2e-global-setup.ts` runs
  once, before any test file is collected. It checks:
  - `current_database()` and `current_user` on both connections;
  - PostgreSQL ≥ 18;
  - superuser refused;
  - the runtime role has no CREATEROLE / CREATEDB / BYPASSRLS / database CREATE /
    privileged-role membership;
  - both connections reach the same server;
  - every repository migration is applied and none is unfinished;
  - the DB marker `telvyn.e2e_instance` equals the profile marker **as a
    database-level setting** (`pg_db_role_setting`, `setrole = 0`, this database).
    A copy at role, role-in-database or cluster level is refused
    (`MARKER_OVERRIDE`), as is a session value that differs from the database-level
    value, and a database owned by `telvyn_app` / `telvyn_migrator`
    (`MARKER_WRITABLE_BY_TEST_ROLE`). So a test role cannot forge the marker with
    `ALTER ROLE … SET` (review finding M2). A test role that is a **member** of the
    database owner role (any membership, inherited or SET, via `pg_has_role(…, 'MEMBER')`)
    is refused the same way (review N1);
  - the Redis marker key `telvyn:e2e:instance-marker` and the logical DB match.

  The server-side port (`inet_server_port()`, 5432 inside a container) is reported
  but **not** required to equal the published host port. Probe errors are never
  echoed, and no diagnostic prints a credential or raw URL.
- **Exclusive run lease (review finding M1):** `test/e2e-run-lease.ts`. After Gate B
  passes, global setup takes a PostgreSQL session advisory lock
  (`pg_try_advisory_lock`) on a dedicated one-connection client in the verified E2E
  database. A second run against the same instance is refused (`INSTANCE_BUSY`)
  before any test file runs. That protects the state that cannot be run-owned: the
  GLOBAL kill-switch singleton and the loopback rate-limit windows.
  - A heartbeat (1 s, 3 s stall limit) exits the main process non-zero if the lock is
    no longer held by the same backend, so no further test file is scheduled.
  - **Worker execution fence (review N2, INC-DB-001B-PRE2):** every test-worker
    process holds a SHARED advisory lock (class `TELV`, object 2) on its own pinned
    session (`test/e2e-worker-fence.ts`, first `beforeAll` / last `afterAll`), and
    verifies every 1 s that the lease is held by exactly the published lease session
    (backend pid + `backend_start`). On loss, error or stall the worker SIGKILLs
    itself — Vitest 3 replaces `process.exit` in workers with a throwing stub, so
    `process.exit` cannot stop a worker. No test body, hook or cleanup of the
    interrupted file runs afterwards. A worker also terminates if its IPC channel to
    the main process closes. The lane is pinned to `pool: "forks"`.
  - **Drain:** a new run takes the lease, then requires the worker fence to be free
    (exclusive try-lock on object 2) twice, 5 s apart; a live worker of an earlier run
    makes it `INSTANCE_BUSY`. The 5 s grace exceeds a worker's detection bound
    (1 s heartbeat + 3 s stall), so no two runs mutate the instance at the same time.
  - **Bounds (not instantaneous, not atomic across PostgreSQL and Redis):** a
    statement or Redis command already sent may complete; detection is ≤ one
    heartbeat plus one in-flight check; a worker whose event loop is blocked cannot
    react until it yields. Live drills (local-verify) observed 1 write 136 ms after a
    lease cut and 4 writes within 774 ms after a worker-fence cut, then none.
  - Global teardown releases the lock, and PostgreSQL releases it if the run crashes.
  - This is an interlock between cooperating runs, not a defence against an operator.
- **Worker re-check:** every E2E file and `fixture-db.ts` import `test/e2e-guard.ts`
  first. It re-runs Gate A and requires the credential-free fingerprint that Gate B
  verified (Vitest `provide` / `inject`). A file run outside the guarded lane fails
  before any client is constructed.
- **No fallbacks:** all shared-target `??=` lines are removed. `fixture-db.ts` builds
  its client only from the validated `E2E_FIXTURE_DATABASE_URL`, with no
  `DATABASE_URL`, default-client or `.env` fallback.
- **Scoped cleanup (`test/e2e-run.ts`):**
  - Users carry a per-run email domain (`<runId>.e2e.telvyn.test`).
  - Tenants are reached only through run users, or through run-scoped prefixes for
    telecom, region and reservation names.
  - Redis uses cursor `SCAN` only. Rate-limit keys are reset for loopback callers and
    run emails only; fraud counters only for run-owned tenants.
  - A GLOBAL kill switch is deleted only if it was absent before the run and toggled
    by a run user.
  - Never `FLUSHDB`, `FLUSHALL` or `KEYS`, and never disabling triggers.
- **CI:** service ports are published on 55432/56379, and the `ci-ephemeral` markers
  are applied by a dedicated step. The unit and E2E lanes run as separate steps.
- **Tests:**
  - `test/e2e-target-guard.unit.test.ts`: Gate A/B negatives and positives with
    mocks, with no sockets.
  - `test/e2e-run-lease.unit.test.ts`: lease acquire, busy, failure, loss and
    release with a mocked driver.
  - `test/e2e-safety-static.unit.test.ts`: config, scripts and source scan.
  - `test/e2e-cleanup-scope.e2e.test.ts`: legacy-shaped sentinels survive the scoped
    cleanup on the isolated instance.
