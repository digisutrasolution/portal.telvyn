# UI_UX.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md (EXISTING / PLANNED / PROPOSED / UNKNOWN).
> Severity scale used by audits: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

## Current state — EXISTING

- **Design system v0.1 specification** — this document, §"Design system v0.1"
  (status: **APPROVED** by owner, 2026-08-26 — binding for all UI work).
- **Visual reference sheet** — [`docs/design/telvyn-design-system.html`](design/telvyn-design-system.html):
  self-contained, all tokens + component examples, live Light/Dark/System
  toggle. Render-verified (no console errors, both themes resolve).
- **Application shell SHIPPED (Phase 1, 2026-08-26)** — see "Component inventory" section at the end of this file. ADR-0001 forbids
  reusing any other project's design system (pre-implementation reuse
  inspection re-confirmed 2026-08-26: zero existing components in this repo).

## UI/UX audit — 2026-08-26 (summary)

Component-level audit found zero UI artifacts → zero inherited debt. Findings:

| ID | Severity | Finding | Status |
|---|---|---|---|
| UX-001 | INFO | No UI exists; re-audit at first shipped screens | Open (by design) |
| UX-002 | HIGH | Target experience defined but undesigned | **RESOLVED**: design system v0.1 approved by owner 2026-08-26 |
| UX-003 | HIGH | No brand identity | **RESOLVED** (v0.1 identity approved); formal logo asset still UNKNOWN |
| UX-004 | MEDIUM | Stock-theme risk | Mitigated by rule: components skinned by Telvyn tokens from day one |
| UX-005 | MEDIUM | Operator workflows unmappable until roles/tenancy decided | Open — blocked on PROJECT_STATE UNKNOWNs |
| UX-006 | LOW | A11y/theming unenforced without CI | Open — axe + both-theme checks land with frontend scaffold |

## The PROMAX design mandate — PLANNED (owner-locked 2026-08-26)

**Global telecom carrier NOC + fintech control plane + premium enterprise
SaaS. NOT a generic admin dashboard.** Owner-added constraints (2026-08-26):
no generic admin templates, no excessive gradients, no excessive
glassmorphism, no huge cards, no excessive rounded containers, no decorative
UI that reduces information density. Reusable components only — never
page-specific duplicates.

Hard "never"s:
1. Never a default component-library theme shipped unmodified.
2. Never a KPI-card grid as the dashboard's primary content — the dashboard is
   an operational cockpit (queues, health, anomalies).
3. Never charts as decoration — every chart answers an operator question.
4. Never color-only status, icon-only actions without labels, or truncated
   ids without copy affordances. Never emoji as icons.
5. Never modal-stacking for complex flows — drawers/pages with preserved context.
6. Never raw hex/px in components — tokens only.

---

# Design system v0.1 — APPROVED (owner, 2026-08-26) — final design rules

Single source of truth: CSS custom properties (design tokens). Reference
implementation: `docs/design/telvyn-design-system.html`. Components consume
tokens exclusively.

## 1. Theming — Light / Dark / System (three-mode)

- `:root` defines the complete **light** palette (light is the default).
- `[data-theme="dark"]` redefines tokens for explicit **dark**.
- **System** mode = no `data-theme` attribute; `@media (prefers-color-scheme:
  dark)` guarded as `:root:not([data-theme="light"])` supplies dark values.
- `color-scheme` set per theme (native form controls/scrollbars follow).
- Dark is a first-class NOC theme (designed together with light, not
  inverted); both themes CI-verified (UX-006).

## 2. Typography

| Role | Face | Weights | Notes |
|---|---|---|---|
| Display/headings | **Space Grotesk** | 500/600/700 | Distinctive, technical-premium; wordmark direction |
| UI/body | **IBM Plex Sans** | 400/500/600 | Engineered enterprise voice, high legibility |
| Data | **IBM Plex Mono** | 400/500/600 | ALL money, E.164, ids, timestamps, durations |

- Scale: **12 · 13 · 14 · 16 · 19 · 24 · 28** px. Body 14 px on console
  surfaces (16 px on reading surfaces); 12 px only for micro-labels — never body.
- Line-height 1.55 body, 1.2 headings. Weight hierarchy: 400 body / 500
  labels-buttons / 600 headings / 700 display only.
- `font-variant-numeric: tabular-nums` wherever numbers render. Fallback
  stacks required on every face.

## 3. Color tokens

Neutral "ink" scale (cool slate-blue cast) + **Telvyn Signal** accent (cyan-teal).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#F5F7FA` | `#0B0F16` | App canvas |
| `--surface` | `#FFFFFF` | `#111723` | Cards, tables, drawers |
| `--surface-2` | `#EEF1F5` | `#18202F` | Hover, wells, rails |
| `--surface-3` | `#E3E8EF` | `#1F2A3C` | Pressed, skeleton hi |
| `--line` | `#D8DEE6` | `#232D3F` | Hairlines/dividers |
| `--line-strong` | `#AFB9C6` | `#3A4A66` | Input borders, th rule |
| `--text` | `#0E1420` | `#E7ECF4` | Primary (≥13:1) |
| `--text-2` | `#3D4A61` | `#A8B3C5` | Secondary (≥7:1) |
| `--muted` | `#5E6B81` | `#8593A9` | Labels/meta (≥4.5:1) |
| `--accent` | `#0E7490` | `#22D3EE` | Telvyn Signal — interactive |
| `--accent-strong` | `#155E75` | `#67E8F9` | Hover |
| `--accent-soft` | `#E0F2F7` | `#10333D` | Selected/active fills |
| `--on-accent` | `#FFFFFF` | `#06181E` | Text on accent |

## 4. Semantic status colors (never color-only — always dot/icon + label)

| Meaning | Token | Light | Dark | Soft fill (badges/alerts) |
|---|---|---|---|---|
| Active / ok / healthy | `--ok` | `#15803D` | `#4ADE80` | `--ok-soft` |
| Pending / porting / info | `--info` | `#1D4ED8` | `#93C5FD` | `--info-soft` |
| Degraded / at-risk | `--warn` | `#B45309` | `#FBBF24` | `--warn-soft` |
| Failed / fraud / danger | `--danger` | `#B91C1C` | `#F87171` | `--danger-soft` |
| Frozen / suspended | `--frozen` | `#6D28D9` | `#C4B5FD` | `--frozen-soft` |
| Released / inactive | `--neutral-status` | `#5E6B81` | `#8593A9` | `--neutral-soft` |

Money discipline: amounts render in `--text`; only **deltas/outcomes** use
ok/danger. Destructive actions use `--danger` and are spatially separated.

## 5. Spacing, density, radius, borders

- Base grid **4 px**: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
- **Density tiers** (user-selectable on tables): compact 32 px rows (default
  for operator tables) / default 40 / comfortable 48.
- Radius: **4 px** badges/small chips · **6 px** controls (buttons, inputs) ·
  **8 px** containers (cards, drawers, modals) · `999px` ONLY filter chips +
  status dots. Nothing larger — mandate.
- Borders: 1 px hairlines (`--line`) carry structure; `--line-strong` for
  inputs and table header rules. Dividers are the density tool — not padding.

## 6. Shadows, elevation, z-index

- **L0** flat (page background) · **L1** `--elev-1` cards/tables/popovers ·
  **L2** `--elev-2` drawers/modals/palette/toasts.
- Light: subtle shadow + 1 px hairline ring. Dark: elevation = **surface
  lightening + hairline**, shadows minimal (no glow, no glass).
- Scrim: 50% (light) / 66% (dark) black — foreground isolation per MD scrim rule.
- Z-scale (only these): `0` content · `10` sticky headers · `40` drawers ·
  `50` modals/palette · `100` toasts.

## 7. Icons

- **Lucide** (SVG, outline), 1.5 px stroke, one style per hierarchy level.
- Size tokens: 14 / 16 / 20 / 24. Icons never appear without an accessible
  name; action icons get labels or tooltips. No emoji, ever.

## 8. Motion

- Micro-interactions 150–250 ms, ease-out enter / ease-in exit (exit ≈ 70% of
  enter); drawers 250 ms slide; toasts 200 ms.
- Motion communicates state change only — no decorative animation.
  `prefers-reduced-motion` disables non-essential motion (skeleton shimmer
  included). Animations interruptible; never block input; transform/opacity only.

## 9. Accessibility — WCAG 2.2 AA (binding)

- Contrast: text ≥4.5:1 (large ≥3:1), non-text UI ≥3:1 — **verified per theme**.
- Focus: `:focus-visible` = 2 px accent ring + 2 px surface offset (2.4.11/12/13).
- Target size ≥24×24 px CSS (2.5.8); interactive controls ≥32 px height,
  44 px on touch surfaces.
- Full keyboard paths; tab order = visual order; skip-link; focus moved to
  main region on route change; drag operations have click alternatives (2.5.7).
- Status = color + shape/icon + text. `aria-live="polite"` toasts;
  `role="alert"` errors; `aria-sort` on sorted columns; labels on all fields
  (never placeholder-only); errors below field with cause + fix.

## 10. Component contracts (reusable library — no page-specific duplicates)

| Component | Contract |
|---|---|
| **Button** | Variants: primary (accent, one per view), secondary (outline), ghost, danger (outline→soft fill hover). 32 px min height, 6 px radius, 500 weight. Loading = disabled + spinner + label kept. Disabled 45% opacity + cursor. |
| **Input** | 34 px height, `--line-strong` border, visible label (12 px/600) above, persistent helper text below, error replaces helper (cause + fix), `aria-invalid`, validate on blur. Data inputs (E.164, money) use Plex Mono. Semantic `type`/`autocomplete` set. |
| **Select** | Native `<select>` styled by tokens (system-controls rule); custom combobox only when search-inside is required, with full ARIA pattern. |
| **Table** | THE primary surface. In-container `overflow-x`, sticky header, sortable (`aria-sort`), uppercase 11 px header labels, compact default density, row hover `--surface-2`, row actions ghost buttons revealed on hover/focus, numeric columns right-aligned mono, freshness stamp in toolbar, virtualize ≥50 rows. |
| **Card** | L1, 8 px radius, 16 px padding. Small and purposeful — never "huge cards"; a card that only wraps a table is forbidden (table stands alone). |
| **Drawer** | Right-side, L2, ≤480 px, for detail/edit preserving list context; deep-linkable; header = identity + close; footer = actions; focus-trapped, ESC + scrim click close (confirm if dirty). |
| **Modal** | Confirmation/simple input ONLY. ≤400 px, consequence-explicit for money/provisioning ("MRC $1.50 stops · balance unchanged"), never stacked, focus-trapped, ESC-safe. |
| **Tabs** | Underline style (2 px accent), 36 px height, `role="tablist"`; URL-synced for deep links. |
| **Badge** | Uppercase 11 px/600, soft-fill + semantic text color, 4 px radius. Status badges always dot/icon + word. |
| **Alert** | Inline, soft fill + 1 px semantic border, icon + bold title + body, `role="alert"` for danger. Never toast-only for critical events. |
| **Toast** | L2, bottom-right, 3–5 s auto-dismiss (persistent if action required), `aria-live="polite"`, never steals focus, undo affordance where reversible. |
| **Tooltip** | 300 ms delay, keyboard-triggerable (focus), never sole carrier of critical info; used for truncated ids + icon actions. |
| **Charts** | Line = trend, horizontal bar = comparison (direct-labeled, no pie >5 cat — prefer no pie at all), sparklines in tiles. `--line` gridlines, series from accent/info/frozen/neutral, data ≥3:1 contrast, `role="img"` + insight-summary aria-label, table alternative for a11y, tabular numerals, honest empty/error/loading states. |
| **Status indicator** | Dot (8 px) + label, semantic color; the single status language across DID/order/port/payment/system. |
| **Health indicator** | Cockpit tiles: pulse dot + big tabular number + quiet label; freshness timestamp; click-through to the queue it summarizes. |
| **Navigation** | Left rail 200 px (collapsible to icon rail with tooltips), ≤7 top-level items, icon + label always, `aria-current` highlight, queue count badges, breadcrumbs at depth ≥3, nav placement identical on every page. |
| **Command palette** | ⌘K/Ctrl-K global, L2 dialog: fuzzy E.164-aware search (with/without `+`/spaces) across numbers/customers/actions/nav; keyboard-first (↑↓ ↵ esc); recent items when empty. |
| **Empty state** | Teach + act ("No DIDs yet → Order your first number"); honest zeros; never fake data. |
| **Loading** | Skeletons mirror final layout (>300 ms ops); shimmer respects reduced-motion; no spinner-only pages; buttons carry their own loading state. |
| **Error state** | Human message (cause + recovery) mapped from RFC 7807, retry affordance, correlation id shown for support; never raw stack traces. |

## 11. Layout & responsive

- Desktop-first console, mobile-capable: 1440 / 1024 / 768 / 360 breakpoints.
- ≥1024: rail + content (max-width 1440 content well). <1024: rail collapses
  to icon rail. <768: top bar + sheet nav; tables become key-value card lists;
  approvals/monitoring fully functional at 360 px.
- No page-level horizontal scroll ever; wide content scrolls in-container.
- `min-h-dvh`, viewport meta, zoom never disabled.

---

## 25-area acceptance contract

Retained as the per-screen audit rubric — see repository history (2026-08-26
audit) for the full table; the component contracts above supersede it as the
build spec. Navigation ≤2 levels; dashboard = cockpit; density user-selectable;
both themes verified; WCAG 2.2 AA per §9.

## Build order (unchanged)

1. ~~Design tokens~~ → **done in v0.1, pending approval**
2. ~~Owner approval~~ → **APPROVED 2026-08-26**
3. Component library implementation (post ADR-0002 stack) skinned to tokens
4. Phase-1 screens: login, cockpit, DID inventory, DID drawer
5. Billing surfaces · 6. Admin/RBAC, audit, porting desk

## UNKNOWN

- Formal logo/wordmark (v0.1 uses a provisional "T" mark + Space Grotesk type direction)
- Component stack (follows ADR-0002)
- Operator task inventory (follows roles/tenancy decisions — UX-005)

---

## Component inventory — EXISTING (Phase 1, shipped 2026-08-26)

Verified: `tsc` clean · 13/13 Vitest tests · `next build` clean (102 kB first
load, all-static) · runtime-verified in-browser (a11y tree, Ctrl+K palette
open/close, dark-mode tokens, /numbers routing, 375 px mobile: sidebar hidden,
sheet-nav button shown, no horizontal overflow, zero console errors).

Reusable primitives (`apps/web/src/components/ui/`): button (primary/
secondary/ghost/danger, sm/md/lg/icon), badge, status (dot+label), kbd,
tooltip, dropdown-menu, popover, dialog + sheet, command (cmdk), separator.

Shell (`apps/web/src/components/shell/`): app-shell (providers + skip-link +
layout), sidebar (collapsible rail, persisted), topbar, breadcrumbs (pure
`breadcrumbsForPath`, tested), search-button, command-palette (Ctrl/Cmd-K,
E.164-aware `paletteMatch`, tested), notifications (honest empty state),
user-menu (auth seam, Phase 2), tenant-selector (Phase 3 seam),
region-selector, health-indicator ("No telemetry" until Phases 16/20),
theme-selector (Light/Dark/System via next-themes `data-theme`), mobile-nav
(sheet), module-gate (honest phase-gated module pages), brand.

Integration seams (`src/lib/shell-config.ts`): session/tenants/regions/
telemetry typed against future API contracts — no business logic in UI, no
mock data; each seam is replaced by the generated API client when its phase
lands. Nav + palette + breadcrumbs share one config (`src/lib/nav.ts`).

Not yet implemented from the section-10 contracts (arrive with their
consuming phases): select/form fields beyond text input, data table, drawer
(detail), tabs, alert, toast, charts. UX-006 (axe + both-theme CI checks)
still open — lands with CI.

## Auth frontend — EXISTING (Phase 12O-2c, shipped 2026-11-18, ADR-0016)

The app now **requires sign-in**: `<AppProviders>` (theme + tooltip + session)
wraps an `<AuthBoundary>` that renders the sign-in screen for unauthenticated
sessions and the shell only once authenticated. `ThemeProvider`/`TooltipProvider`
moved up from `app-shell` into `app-providers` so the sign-in screen is themed;
`user-menu` now reads the live session and offers sign-out.

New form primitives (`apps/web/src/components/ui/`), skinned to v0.1 tokens,
focus via the global `:focus-visible` ring: **input** (text, `aria-invalid`
border), **label**, **field** (label + control + error[`role=alert`]/hint,
id-wired). First consumers of the section-10 input contract.

Auth screens (`apps/web/src/components/auth/`): **login-screen** (email+password,
then an MFA-code step; disabled-while-pending; RFC 7807 error alert) and
**auth-boundary** (authenticated → shell; unauthenticated → sign-in; forbidden →
no-workspace notice; error → retry; loading). Verified: `tsc` clean · 53/53
Vitest · `next build` clean · live browser render of the gate (brand + notice +
accent button, correct tokens) with no console errors.

Account recovery — EXISTING (Phase 12O-2d, 2026-11-18, ADR-0016 addendum):
**public** screens reached from emailed `?token=` links, rendered themed but
bare (no shell — `AppProviders` routes them past the gate via `isPublicAuthPath`).
**reset-password-screen** (request an email → non-enumerating confirmation; or,
with a token, set a new password with client-side length/match checks),
**verify-email-screen** (confirms on mount → success/failure), a "Forgot
password?" link on sign-in, and a shared **auth-card** now backing all three
screens. Verified: `tsc` clean · 69/69 Vitest · `next build` clean · the
`/reset-password` (request + token) and `/verify-email` routes render-verified
**bare** (no sidebar/topbar) in the browser.

Permission-aware nav + route gating — EXISTING (Phase 12O-2e, 2026-11-18,
ADR-0017): `NavItem` carries a `permission` key, so the sidebar, mobile sheet,
and command palette (all via one `useVisibleNavItems()` hook) show only the
modules the member can access; a central **route-guard** wraps `<main>` and
renders an honest "Access restricted" state for a module the session lacks.
Operations stays the one unguarded landing. UX gating only (the API is the
authority). Verified: `tsc` clean · 77/77 Vitest · `next build` clean (per-role
nav/guard behavior is unit-tested; end-to-end needs the API up + sign-in). Still
to come: read-only NOC pages, MFA enroll/manage, an email-unverified banner.

NOC — Engines overview — EXISTING (Phase 12O-2f, 2026-11-18, ADR-0018): the
first NOC screen. A platform-only "Infrastructure" nav item + `/infrastructure`
route (gated on the platform tenant + `telecom.read`) renders a read-only
engines table (name/type/environment/status badge/health status/version) from
`GET /v1/telecom/engines` via a new `useResource` hook, with honest
loading/empty/error states and **UNKNOWN** health for stub adapters (never
fabricated). Verified: `tsc` clean · 91/91 Vitest · `next build` clean (per-state
UI unit-tested; end-to-end needs the API up + a platform sign-in).

NOC — Engine detail — EXISTING (Phase 12O-2g, 2026-11-18, ADR-0018 addendum):
`/infrastructure/[id]` (linked from each engine name) renders read-only engine
detail — identity header + Health / Connectivity / Configuration-version /
Desired-config cards, loaded from `GET /v1/telecom/engines/:id` and `/:id/status`
via two `useResource` calls, with honest UNKNOWN/UNCONFIGURED states under the
Null connector. No mutating actions. Verified: `tsc` clean · 95/95 Vitest ·
`next build` clean.

NOC — Nodes + Regions + sub-nav — EXISTING (Phase 12O-2h, 2026-11-18, ADR-0018
addendum): the infrastructure section gains a sub-nav (Engines / Nodes /
Regions via `<InfraTabs>` in `app/infrastructure/layout.tsx`) and two read-only
tables — `/infrastructure/nodes` (name/environment/zone/status/heartbeat
health/version) and `/infrastructure/regions` (code/name/country/timezone/
status) — loaded via `useResource` with honest UNKNOWN heartbeat health. All
platform-gated. Verified: `tsc` clean · 107/107 Vitest · `next build` clean (all
four /infrastructure routes).

NOC — engine mutating actions — EXISTING (Phase 12O-2i, 2026-11-18, ADR-0019):
the engine detail page gains an Actions panel — Check-health (direct,
non-destructive, needs `telecom.health.read`) and Sync / Roll back (confirm
dialog first, need `telecom.manage`). Results are shown plainly, including the
honest `501 NOT_IMPLEMENTED` under the Null connector; one action in flight
disables the panel and no mutation is ever auto-retried. Verified: `tsc` clean ·
115/115 Vitest · `next build` clean.

NOC — engine sync/rollback type-to-confirm guard — EXISTING (Phase 12O-2l,
2026-11-19, ADR-0019 addendum): the Sync and Roll back confirm dialogs now carry
a type-to-confirm input — the operator must type the exact engine name before the
CTA enables (case-sensitive, trimmed; GitHub-style mis-click guard for when a real
connector is wired). The typed value resets on open/close; Check-health stays
direct. UX only — the API re-checks permission + platform on every call. Verified:
`tsc` clean · 131/131 Vitest · `next build` clean.

Email-unverified banner — EXISTING (Phase 12O-2j, 2026-11-18): a quiet warn-tone
strip below the topbar (`<EmailVerificationBanner>`) shown when the signed-in
user's email is unverified (read from `GET /v1/auth/me`), with a "Resend email"
action (→ "Verification email sent") and a session dismiss. Renders nothing while
loading, on error, or once verified. Verified: `tsc` clean · 120/120 Vitest ·
`next build` clean.

Account & security — MFA enroll/manage — EXISTING (Phase 12O-2k, 2026-11-19): a
new `/account` page reached from the account menu (no module permission — any
authenticated member; the API authorizes every action). `<MfaSettings>` reads the
authoritative `mfaEnabled` from `GET /v1/auth/me` and drives the contracted TOTP
lifecycle: enroll (scannable QR code of the otpauth URI, with the base32 setup key
as the "can't scan?" manual fallback — Phase 12O-2n) → enter a 6-digit code to turn
on → one-time recovery codes revealed once ("won't be shown again") → step-up
disable in a confirm dialog needing the current password AND a TOTP/recovery code.
Numeric code input (strips non-digits), inline validation, RFC 7807 error alerts,
disabled-while-pending. The QR (`qrcode.react`, SVG) is drawn dark-on-white with a
quiet zone regardless of theme so it always scans, with an accessible `<title>`.
Verified: `tsc` clean · 131/131 Vitest · `next build` clean.

Carriers — read list — EXISTING (Phase 12O-2o, 2026-11-19): a read-only
`/carriers` table of the session's visible carriers (own + system), reached from
a new **Carriers** nav item (gated on `carrier.read`; tenant resource, not
platform-only). Columns: name, scope (SYSTEM/TENANT badge), type, country,
administrative status, codecs, and honest UNKNOWN health. Cursor-paginated with a
"Load more" button; loading / empty / error (RFC 7807 title) states. Secrets never
appear (a carrier carries only a non-secret credential reference). Contract-first:
`GET /v1/telecom/carriers` + `Carrier`/`CarrierPage` authored into the contract and
the client type generated. Verified: `tsc` clean · 135/135 Vitest · `next build`
clean. To come: a carrier detail drawer and list filters (scope/status/search).

SIP trunks — read list — EXISTING (Phase 12O-2p, 2026-11-19): a read-only
`/sip-trunks` table of the tenant's own trunks, reached from a new **SIP trunks**
nav item (gated on `sip_trunk.read`; tenant-scoped). Columns: name, carrier,
direction, transport (with a TLS marker), endpoint (host or SIP URI), status, and
honest UNKNOWN health (control-plane config only — no live connectivity). Cursor-
paginated with "Load more"; loading / empty / error (RFC 7807 title) states.
Secrets never appear (non-secret credential reference + carrier summary only).
Contract-first: `GET /v1/telecom/sip-trunks` + `SipTrunk`/`SipTrunkPage` authored
into the contract and the client type generated. Verified: `tsc` clean · 139/139
Vitest · `next build` clean. To come: a trunk detail drawer and list filters.

Numbers — DID inventory read list — EXISTING (Phase 12O-2q, 2026-11-19): the
`/numbers` module (existing nav item, `did.read`) now shows the tenant's real DID
inventory instead of a placeholder. Columns: number (E.164), country, lifecycle
status (AVAILABLE/RESERVED/ASSIGNED/ACTIVE/SUSPENDED/PORTING/RELEASED badge),
carrier and trunk (short reference ids — the DID API returns ids, not names, with
the full id on hover), assigned date, and honest UNKNOWN health (control-plane
only). Cursor-paginated with "Load more"; loading / empty / error (RFC 7807 title)
states. Contract-first: `GET /v1/telecom/dids` + `Did`/`DidPage` authored into the
contract and the client type generated. Verified: `tsc` clean · 143/143 Vitest ·
`next build` clean. To come: a DID detail drawer and list filters.

Routing — profiles read list — EXISTING (Phase 12O-2r, 2026-11-19): a read-only
`/routing` table of the tenant's own routing profiles, reached from a new
**Routing** nav item (gated on `routing.read`; tenant-scoped). Declarative config
only — nothing is executed. The list shows a per-profile summary: name, direction,
status, selection strategy, failover on/off, rule count, and version; the full
rules (carried in the response) belong in a detail drawer (deferred). Cursor-
paginated with "Load more"; loading / empty / error (RFC 7807 title) states.
Contract-first: `GET /v1/telecom/routing-profiles` + `RoutingProfile`/`RoutingPolicy`/
`RoutingRule`/`RoutingProfilePage` authored into the contract and the client type
generated. Verified: `tsc` clean · 147/147 Vitest · `next build` clean. To come:
a routing detail drawer and list filters.

LCR — policies read list — EXISTING (Phase 12O-2s, 2026-11-19): a read-only `/lcr`
table of the tenant's own least-cost-routing policies, reached from a new **LCR**
nav item (gated on `routing.read`; LCR is part of the routing domain). Declarative
route selection only — nothing is executed, rated or billed. The list shows a
per-policy summary: name, selection strategy, state (enabled/disabled), candidate
count, and version; the ordered route candidates (carried in the response) belong
in a detail drawer (deferred). Cursor-paginated with "Load more"; loading / empty /
error (RFC 7807 title) states. Contract-first: `GET /v1/telecom/lcr-policies` +
`LcrPolicy`/`LcrRoute`/`LcrPolicyPage` authored into the contract and the client
type generated. Verified: `tsc` clean · 151/151 Vitest · `next build` clean. This
completes the telecom read-screen set (carriers, SIP trunks, numbers, routing, LCR).

Carriers — detail drawer — EXISTING (Phase 12O-2t, 2026-11-19): each carriers row
gains a "View" action that opens a modal detail drawer showing the full carrier,
fetched fresh by id (`GET /v1/telecom/carriers/{id}`): scope, type, country,
status, honest UNKNOWN health, priority, codecs, CPS/concurrency caps, the
non-secret credential reference (label · type · scope, or "None"), and created/
updated dates. Keyed by id so each open refetches; loading / error / 404 states.
Read-only (`carrier.read`, re-checked server-side). Contract-first: `getCarrier`
authored into the contract, client type generated. Verified: `tsc` clean · 152/152
Vitest · `next build` clean. This is the detail-view pattern for the other read
screens (trunks, DIDs, routing, LCR) — to come.

SIP trunks — detail drawer — EXISTING (Phase 12O-2u, 2026-11-19): each `/sip-trunks`
row gains a "View" action that opens a modal detail drawer showing the full trunk,
fetched fresh by id (`GET /v1/telecom/sip-trunks/{id}`): carrier summary (name +
scope badge), direction, endpoint (host / SIP URI), port, transport (+ TLS), auth
mode, allowed-IP ACL, codecs, SRTP, DTMF mode, CPS/concurrency caps, administrative
status, honest UNKNOWN health (no live connectivity), the non-secret credential
reference (label · type, or "None"), and created/updated dates. Keyed by id so each
open refetches; loading / error / 404 states; secrets never rendered. Read-only
(`sip_trunk.read`, re-checked server-side). Contract-first: `getSipTrunk` authored
into the contract, client type generated. Verified: 153/153 Vitest · `next build`
clean. Remaining detail drawers (DIDs, routing, LCR) + list filters — to come.

Numbers — DID detail drawer — EXISTING (Phase 12O-2v, 2026-11-19): each `/numbers`
row gains a "View" action that opens a modal detail drawer showing the full DID,
fetched fresh by id (`GET /v1/telecom/dids/{id}`): country, lifecycle status, honest
UNKNOWN health (no live SIP-path check), the related-resource reference ids — carrier,
SIP trunk, routing profile, region — shown in full mono (the DID API returns reference
ids only, never embedded objects; the list shows 8-char refs, the drawer the full ids),
and assigned / created / updated dates. Keyed by id so each open refetches; loading /
error / 404 states. Read-only (`did.read`, re-checked server-side). Contract-first:
`getDid` authored into the contract, client type generated. Verified: 154/154 Vitest ·
`next build` clean. Remaining detail drawers (routing, LCR) + list filters — to come.

Routing — profile detail drawer — EXISTING (Phase 12O-2w, 2026-11-19): each `/routing`
row gains a "View" action that opens a modal detail drawer showing the full profile,
fetched fresh by id (`GET /v1/telecom/routing-profiles/{id}`) — the content the list
deliberately summarized. The drawer shows the profile meta (direction, status,
description, version, created/updated), the complete selection/failover policy
(strategy, failover on/off, failover conditions, max-attempts and overall-timeout
caps), and the full ordered rule set (priority ASC): each rule as a compact card with
priority, destination type + value, enabled state, and optional weight / timeout /
failover. Declarative config only — nothing is executed. The rules list scrolls within
the drawer when long. Keyed by id so each open refetches; loading / error / 404 states.
Read-only (`routing.read`, re-checked server-side). Contract-first: `getRoutingProfile`
authored into the contract, client type generated. Verified: 155/155 Vitest · `next
build` clean. Remaining detail drawer (LCR) + list filters — to come.

LCR — policy detail drawer — EXISTING (Phase 12O-2x, 2026-11-19): each `/lcr` row
gains a "View" action that opens a modal detail drawer showing the full least-cost-
routing policy, fetched fresh by id (`GET /v1/telecom/lcr-policies/{id}`) — the content
the list deliberately summarized. The drawer shows the policy meta (selection strategy,
enabled state, description, version, created/updated) and the full set of route
candidates kept in the server's deterministic selection order (NOT re-sorted — order is
strategy-dependent, e.g. LOWEST_COST): each candidate as a compact card with priority,
prefix + country, cost formatted from integer `costMicros` millionths + currency (never
float money; raw micros in the element title), enabled state, and optional weight /
effective window. Declarative selection only — nothing is executed, rated or billed.
The candidates list scrolls within the drawer when long. Keyed by id so each open
refetches; loading / error / 404 states. Read-only (`routing.read`, re-checked
server-side). Contract-first: `getLcrPolicy` authored into the contract, client type
generated. Verified: 156/156 Vitest · `next build` clean. This COMPLETES the read-screen
detail-drawer set (carriers, SIP trunks, DIDs, routing, LCR). List filters — to come.

List filters — shared primitive + Carriers — EXISTING (Phase 12O-2y, 2026-11-20): a
reusable filter bar for the read screens. `<ListFilters>` (components/telecom) is a
controlled, presentational `role="search"` row: an optional search box plus any number
of accessible native `<select>` controls (each with an "All" option and an `aria-label`,
since they carry no visible label) plus a Clear action shown only when a filter is
active. The parent owns filter state, maps it to the screen's already-contracted list
query params, and debounces the search term via the new `useDebouncedValue` hook (300 ms)
so a fetch fires once typing pauses, not per keystroke. Applied first to the Carriers
screen: search (`q`), status, and scope. Changing a filter resets pagination and
refetches; "Load more" carries the active filters; a filter that matches nothing shows an
honest "No carriers match your filters." state (distinct from the "none configured yet"
empty state) with Clear. `regionId` is deliberately not exposed (no region picker exists
yet). Server stays authoritative and tenant-auto-scoped; the filters are a query
convenience, not an authorization surface. Verified: 165/165 Vitest · `next build` clean.
To come: the same pattern on SIP trunks, numbers, routing and LCR.

List filters — SIP trunks — EXISTING (Phase 12O-2z, 2026-11-20): the 12O-2y pattern
applied to the SIP trunks read screen, reusing `<ListFilters>` and `useDebouncedValue`
unchanged. Exposes four filters mapped to the list endpoint's already-contracted params:
search (`q`, 300 ms debounce), status, direction (inbound/outbound/bidirectional) and
transport (UDP/TCP/TLS). The backend `sip-trunks.service.ts` genuinely applies each
(`where.status`/`direction`/`transport` and a case-insensitive `name contains` for `q`),
so no filter is a dishonest no-op. Changing a filter resets pagination and refetches;
"Load more" carries the active filters; a filter that matches nothing shows an honest
"No SIP trunks match your filters." state (distinct from the "none configured yet" empty
state) with Clear. `carrierId` is deliberately not exposed (no carrier picker exists yet,
mirroring `regionId` on carriers). Read-only; server authoritative + tenant-auto-scoped.
Verified: 169/169 Vitest · `next build` clean (/sip-trunks 5.79 kB). To come: numbers,
routing and LCR.

List filters — Numbers (DIDs) — EXISTING (Phase 12O-2aa, 2026-11-20): the 12O-2y
pattern applied to the Numbers read screen, reusing `<ListFilters>` and `useDebouncedValue`
unchanged. Exposes two filters mapped to the list endpoint's already-contracted params:
search (`q`, 300 ms debounce — a substring match against the canonical E.164) and status
(the 7-value DID lifecycle enum). The backend `dids.service.ts` genuinely applies both
(`where.status` and `where.e164 contains`), so neither is a dishonest no-op. Changing a
filter resets pagination and refetches; "Load more" carries the active filters; a filter
that matches nothing shows an honest "No numbers match your filters." state (distinct from
the "none in inventory yet" empty state) with Clear. The id-based filters (carrier / trunk
/ routing profile / region) are deliberately not exposed (no pickers yet, as on prior
screens); `country` is also not exposed — it has no canonical option source (no countries
endpoint) and its DTO requires exactly two uppercase chars, so a free-text box would be
400-prone, and the E.164 search already covers finding a specific number. Read-only; server
authoritative + tenant-auto-scoped. Verified: 172/172 Vitest · `next build` clean (/numbers
5.36 kB). To come: routing and LCR.

List filters — Routing profiles — EXISTING (Phase 12O-2ab, 2026-11-20): the 12O-2y
pattern applied to the Routing read screen, reusing `<ListFilters>` and `useDebouncedValue`
unchanged. Exposes four filters mapped to the list endpoint's already-contracted params:
search (`q`, 300 ms debounce — case-insensitive name), status, direction (inbound/outbound)
and strategy (priority / weighted / round-robin / simultaneous). The backend
`routing.service.ts` genuinely applies each (`where.status`/`direction`/`selectionStrategy`
and a case-insensitive `name contains` for `q`), so no filter is a dishonest no-op. Changing
a filter resets pagination and refetches; "Load more" carries the active filters; a filter
that matches nothing shows an honest "No routing profiles match your filters." state
(distinct from the "none configured yet" empty state) with Clear. Declarative config only —
nothing is executed. Read-only; server authoritative + tenant-auto-scoped. Verified: 176/176
Vitest · `next build` clean (/routing 5.74 kB). To come: LCR.

List filters — LCR policies — EXISTING (Phase 12O-2ac, 2026-11-20): the 12O-2y pattern
applied to the LCR read screen, reusing `<ListFilters>` and `useDebouncedValue` unchanged —
completing the read-screen filter set (carriers / SIP trunks / numbers / routing / LCR).
Exposes three filters mapped to the list endpoint's already-contracted params: search (`q`,
300 ms debounce — case-insensitive name), strategy (lowest-cost / highest-priority /
weighted / quality-first) and a tri-state state filter (enabled / disabled). The state
select holds the string "true"/"false" and the view maps it to a real boolean
(`enabled: value === "true"`) before fetching. Honesty note: the backend list query had
`enabled` on `z.coerce.boolean()` (`Boolean("false") === true`), which silently inverted
`enabled=false` into `true`; this phase fixed that in `lcr.dto.ts` (explicit string→boolean
parse, covered by `lcr.dto.test.ts`) so the Disabled option is a true filter, not a no-op.
Changing a filter resets pagination and refetches; "Load more" carries the active filters;
a filter that matches nothing shows an honest "No LCR policies match your filters." state
(distinct from the "none configured yet" empty state) with Clear. Declarative selection
only — nothing is executed, rated or billed; `costMicros` stays an integer. Read-only;
server authoritative + tenant-auto-scoped. Verified: 180/180 web Vitest + 192 API unit ·
`next build` clean (/lcr 5.48 kB). The read-screen filter set is now complete.

Admin — Members — EXISTING (Phase 12O-2ad, 2026-11-20): the `/admin` route, until
now a ModuleGate placeholder, is a real read-only members list — the last NOC/admin
read surface. It shows every member of the session's own tenant in a table: name
(null → "—"), email (mono), membership status (ACTIVE / SUSPENDED badge), account
status (ACTIVE / INVITED / DISABLED badge — surfacing pending invites honestly) and
the member's role names as neutral badges. The backend `GET /v1/members` endpoint
already existed (`member.read`); this phase authored it into the contract (`Member`
schema) and built the screen. The endpoint returns a plain array (a team is small —
no pagination), so the view loads the full list once via `useResource` with a
Refresh action; there is no Load-more and no filter bar (members have no contracted
query params — a filter sub-phase would need backend work first). Honest
loading/empty/error states; no secrets. The route is gated by nav `member.read` +
RouteGuard (not platform-only, so any tenant member with `member.read` sees it); the
server auto-scopes to the session's tenant. Read-only — member management (invite /
role changes) is a later phase. Verified: 183/183 web Vitest · `next build` clean
(/admin 3.73 kB).
