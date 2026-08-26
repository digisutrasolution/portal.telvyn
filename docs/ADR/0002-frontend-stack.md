# ADR-0002 — Frontend stack: Next.js + TypeScript + Tailwind + shadcn/ui

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** Product owner (directive), architect

## Context

Phase 1 (Application Shell) requires the frontend stack decision. The owner
directed: Next.js, TypeScript, Tailwind, shadcn/ui, accessible, keyboard
friendly, dark/light mode, responsive, production ready.

## Decision

- **Next.js 15 (App Router) + React 19 + TypeScript 5** — `apps/web` in a
  pnpm monorepo (workspace layout anticipates `apps/api` later).
- **Tailwind CSS v4** (CSS-first config) with the approved Design System v0.1
  tokens as CSS custom properties mapped via `@theme inline` — components
  consume semantic utilities (`bg-surface`, `text-ink`, `border-line`), never
  raw hex/px (mandate rule 6).
- **shadcn/ui-style component layer**: Radix UI primitives + cva/clsx/
  tailwind-merge + `cmdk` + `lucide-react`, hand-skinned to Telvyn tokens
  from day one (never the stock theme — mandate rule 1). Components live in
  `apps/web/src/components/ui` (reusable primitives) and
  `src/components/shell` (composition).
- **Theming**: `next-themes` with `attribute="data-theme"` — Light / Dark /
  System per the v0.1 three-mode contract.
- **Testing**: Vitest + Testing Library (jsdom) for unit/component tests;
  `tsc --noEmit` typecheck; `next build` as the build gate.

## Consequences

- Phase 1/5 unblocked; the design system reference sheet maps 1:1 onto
  Tailwind v4 tokens.
- **The backend stack is NOT decided here** — API framework, ORM, queue and
  cache technology remain open (gates Phases 2/3/8; will be a follow-up ADR).
  Until then the frontend contains no business logic and no data fetching —
  shell state comes from typed configuration seams to be replaced by the
  generated API client (contract-first rule).
- pnpm workspace + lockfile committed; CI gates (typecheck/test/build) run
  from the repo root.
