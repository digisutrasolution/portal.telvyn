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
`next build` clean. Next: nodes/regions, then mutating NOC actions.
