# ADR-0001 — Telvyn is a fully independent product and codebase

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** Product owner

## Context

The owner's workspace contains other telephony products (a legacy PHP VoIP
portal and a modern cloud-telephony SaaS in design). Before starting Telvyn,
it had to be decided whether Telvyn would (a) be fully independent, (b) fork
an existing foundation, or (c) ride an existing platform's white-label tenancy.

A workspace inspection (2026-08-26) confirmed no Telvyn code exists anywhere —
this is a greenfield build.

## Decision

Telvyn DID Portal PROMAX is a **fully independent new product and codebase**
(option a). No code, database, branding, or deployment relationship to
ForwardingMyCalls or any other project.

## Consequences

- Free choice of stack and architecture (ADR-0002 to follow) — no inherited
  constraints or debt.
- No shared components: proven *patterns* from prior work (double-entry ledger,
  DID lifecycle modeling, contract-first APIs, token-based theming) may be
  re-implemented on their merits, but nothing is imported or forked.
- Telvyn requires its own brand identity, design system, infrastructure,
  carrier contracts, and compliance posture.
- Repository root: `D:\Claude Dev\portal.telvyn.co`; production domain:
  `portal.telvyn.co`.
