# ADR-0003 — Backend stack: NestJS + Prisma + PostgreSQL 18 + Redis

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** Architect (owner authorized by ordering Phase 2 implementation
  after the gate was flagged)

## Context

Phase 2 (authentication) requires the backend stack (open half of ADR-0002).
Constitution constraints: API-first separate service, contract-first OpenAPI,
PostgreSQL, UUIDv7 PKs, migrations-only DDL, argon2id, stateless horizontal
scaling, queues later, single-language leverage with the TypeScript frontend.

## Decision

- **NestJS 11 (Express platform) + TypeScript** as `apps/api` — modular
  enterprise structure (module/controller/service/guard) matching the clean-
  architecture rule; port **3311** in dev.
- **PostgreSQL 18** (native `uuidv7()` — resolves DB-007) via **Prisma 6**;
  raw-SQL migration lane available inside Prisma migrations for partial
  uniques / RLS / partitions when those phases arrive.
- **Redis 7** for rate limiting, brute-force counters, and future
  cache/queues. Security decisions **fail closed** when Redis is down.
- **Zod** for boundary validation (shared idiom with the frontend);
  RFC 7807 problem+json error filter.
- **Contract-first**: `packages/contracts/openapi/telvyn.v1.yaml` is authored
  before implementation; the frontend client is generated from it (never
  hand-written).
- Auth primitives: `argon2` (argon2id), `@nestjs/jwt` (HS256 access tokens;
  key rotation via env), `otplib` (TOTP), AES-256-GCM app-key encryption for
  MFA secrets (pointer-to-secret-manager upgrade path documented in
  SECURITY.md).
- Email delivery is a seam: tokens are stored hashed in PostgreSQL and
  messages are written to an `EmailOutbox` table; SMTP/worker wiring is
  deploy configuration (Phase 20), never fake sends.

## Consequences

- One language and one validation idiom across the stack; contract-first is
  enforceable in CI (client regenerated from the YAML).
- Tenancy (DB-002) remains CRITICAL-open: auth-domain tables carry a nullable
  `tenant_id` reserved column so the Phase 3 tenancy migration is additive —
  the documented backward-compatible path (no rewrite of auth).
- Queue technology (BullMQ vs AMQP) is still deferred to the telecom
  foundation ADR (Phase 8); nothing in this phase blocks on it.
