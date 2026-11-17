# Architecture Decision Records

One file per decision, numbered sequentially: `NNNN-short-slug.md`.
A decision, once **Accepted**, is not re-litigated — superseding requires a new
ADR that references the old one. Template: `template.md`.

| # | Title | Status |
|---|---|---|
| 0001 | Telvyn is a fully independent product and codebase | Accepted |
| 0002 | Frontend stack: Next.js + TypeScript + Tailwind + shadcn/ui | Accepted |
| 0003 | Backend stack: NestJS + Prisma + PostgreSQL 18 + Redis | Accepted |
| 0004 | Tenant isolation: server-derived context + data-layer scoping + RLS | Accepted |
| 0005 | PostgreSQL RLS: deferred as staged defense-in-depth | Accepted |
| 0006 | Control plane vs telecom data plane | Accepted |
| 0007 | Provider-neutral telecom engine abstraction | Accepted |
| 0008 | Carrier abstraction: platform/wholesale vs tenant | Accepted |
| 0009 | Telecom credential vault (secret material separation) | Accepted |
| 0010 | Telecom node: configuration vs runtime, and the health model | Accepted |
| 0011 | Engine runtime integration boundary | Accepted |
| 0012 | Engine ↔ resource assignment model | Accepted |
