# ADR-0017 — Permission-aware navigation + route gating

- **Status:** Accepted (owner-authorized Phase 12O-2e; implemented 2026-11-18)
- **Date:** 2026-11-18
- **Deciders:** Architect / Security / Frontend
- **Related:** ADR-0014 (`/v1/me/context`), ADR-0015 (session foundation),
  ADR-0016 (auth gate). Permission keys come from the server catalog
  (`apps/api/src/authz/permission-catalog.ts`).

## Context

The session now exposes the member's expanded permission set
(`useSession().hasPermission`). The shell still showed every module to every
authenticated member and let anyone open any module route. Navigation and routes
should reflect what the member can actually access — a deny-by-default UX that
mirrors the server's deny-by-default authorization.

## Decision

1. **Nav items carry a permission.** `NavItem` gains an optional `permission`
   key (a real catalog key). Undefined = visible to any authenticated member
   (only the Operations landing). The owner-approved mapping:

   | Module | Route | Permission |
   |---|---|---|
   | Operations | `/` | — (always visible landing) |
   | Numbers | `/numbers` | `did.read` |
   | Porting | `/porting` | `did.read` |
   | Billing | `/billing` | `wallet.read` |
   | CDRs | `/cdrs` | `wallet.read` (provisional) |
   | Admin | `/admin` | `member.read` |

   CDRs have **no** dedicated catalog permission yet; they are gated on
   `wallet.read` (usage is billing-adjacent) until a `cdr.read` key is
   introduced with the CDR module (Phase 14). (Note: the `admin` system role
   lacks `wallet.read`, so it will not see Billing/CDRs — this is accurate to
   the RBAC catalog, not a frontend choice.)

2. **One filter for all nav surfaces.** A `useVisibleNavItems()` hook returns
   the items the session may see; the sidebar, mobile sheet, and command palette
   all consume it, so nav can never drift between surfaces.

3. **Central route gate.** A `<RouteGuard>` wraps the shell's `<main>`. It
   derives the required permission from the nav config
   (`requiredPermissionForPath(pathname)`) and renders the page only when the
   session holds it; otherwise an honest "Access restricted" state. One place
   gates every module route (and its sub-paths) — no per-page boilerplate.

4. **UX only; server stays the authority.** Both the nav filter and the route
   gate decide *what to show*, never *what is allowed*. Every API route keeps
   its own permission + platform checks, so a hand-typed URL or a tampered
   client reveals no data — the API refuses it regardless of the gate.

## Options considered

1. **Per-page `<RequirePermission>` wrappers.** Rejected — boilerplate in every
   page; easy to forget on a new route. The central guard derives the rule from
   the single nav source of truth.
2. **Nav filtering only, no route block.** Rejected — hiding a link but serving
   the page to a hand-typed URL is inconsistent; the guard makes the boundary
   explicit (the API is still the real authority either way).
3. **Nav filter + central route guard (chosen).**

## Consequences

- Deny-by-default UX: members see and reach only their modules; the Operations
  landing stays universal so everyone has a home.
- The permission map lives in one config (`src/lib/nav.ts`); changing a module's
  gate is a one-line edit. A new module adds its `permission` there.
- CDRs carry a provisional gate; introducing `cdr.read` later is a catalog
  addition plus a one-line nav change (no structural work).
- Covered by unit tests (`requiredPermissionForPath` mapping; `NavList`
  shows/hides per permission; `RouteGuard` allow/deny/unguarded) and a
  production build. End-to-end behavior per real role is verifiable once the API
  is running and a member signs in.
- No backend/API/schema/DI change.