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

/** A telecom engine (platform), with honest health. */
export type Engine = Schemas["Engine"];

/** Engine health result (status + optional latency/detail). */
export type EngineHealth = Schemas["EngineHealth"];

/** Normalized engine status: health + connection + config-version posture. */
export type EngineStatus = Schemas["EngineStatus"];

/** A telecom region (platform). */
export type Region = Schemas["Region"];

/** A telecom node with heartbeat health (platform). */
export type Node = Schemas["Node"];

/** Result of an active engine health probe. */
export type EngineHealthReport = Schemas["EngineHealthReport"];

/** Outcome of an engine config sync / rollback attempt. */
export type SyncOutcome = Schemas["SyncOutcome"];
