# SECURITY.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md (EXISTING / PLANNED / PROPOSED / UNKNOWN).
> Severity scale used by audits: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

## Current state — EXISTING

**No application code exists**, therefore no implemented controls and no
exploitable runtime surface. This document records: (1) the defensive security
audit of what *does* exist (repository content), (2) the severity-classified
findings register, (3) the committed control set, and (4) the 30-area security
baseline every feature must ship against.

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
