/**
 * Ergonomic, hand-free aliases over the generated OpenAPI types.
 *
 * `schema.ts` is auto-generated from the single canonical contract
 * (`packages/contracts/openapi/telvyn.v1.yaml`) — contract-first, ADR-0002.
 * NEVER edit `schema.ts` by hand; regenerate it with `pnpm gen:contracts`
 * after the contract changes. This file only re-exports named shapes so the
 * app imports `MeContext` instead of `components["schemas"]["MeContext"]`.
 */
import type { components } from "./schema";

export type Schemas = components["schemas"];

/** Current session's server-derived authorization context (GET /v1/me/context). */
export type MeContext = Schemas["MeContext"];

/** A single role carried on the session's membership. */
export type Role = MeContext["roles"][number];

/** RFC 7807 problem body (application/problem+json). */
export type Problem = Schemas["Problem"];

/** Access token (+ expiry) returned by login / mfa-verify / refresh. */
export type TokenPair = Schemas["TokenPair"];

/** Login step-1 result: either a token pair or an MFA challenge. */
export type LoginResult = Schemas["LoginResult"];
