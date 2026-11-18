/**
 * Ergonomic, hand-free aliases over the generated OpenAPI types.
 *
 * `schema.ts` is auto-generated from the single canonical contract
 * (`packages/contracts/openapi/telvyn.v1.yaml`) — contract-first, ADR-0002.
 * NEVER edit `schema.ts` by hand; regenerate it with `pnpm gen:contracts`
 * after the contract changes. This file only re-exports named shapes so the
 * app imports `MeContext` instead of `components["schemas"]["MeContext"]`.
 */
import type { components, operations } from "./schema";

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

/** The authenticated user's identity (GET /v1/auth/me). */
export type Me = Schemas["Me"];

/** Begin-TOTP-enrollment result (POST /v1/auth/mfa/enroll): an otpauth:// URI. */
export type MfaEnrollResult = operations["mfaEnroll"]["responses"]["200"]["content"]["application/json"];

/** Enable-MFA result (POST /v1/auth/mfa/enable): one-time recovery codes. */
export type MfaEnableResult = operations["mfaEnable"]["responses"]["200"]["content"]["application/json"];

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

/** A carrier (tenant or system), with honest health and a non-secret credential ref. */
export type Carrier = Schemas["Carrier"];

/** Cursor-paginated page of carriers. */
export type CarrierPage = Schemas["CarrierPage"];

/** Non-secret vault credential reference attached to a carrier. */
export type CarrierCredentialRef = Schemas["CarrierCredentialRef"];

/** A SIP trunk (tenant-owned), with honest health and a non-secret credential ref. */
export type SipTrunk = Schemas["SipTrunk"];

/** Cursor-paginated page of SIP trunks. */
export type SipTrunkPage = Schemas["SipTrunkPage"];

/** A DID (phone number); related resources are reference ids only. */
export type Did = Schemas["Did"];

/** Cursor-paginated page of DIDs. */
export type DidPage = Schemas["DidPage"];

/** A routing profile (tenant) with its declarative policy and ordered rules. */
export type RoutingProfile = Schemas["RoutingProfile"];

/** Cursor-paginated page of routing profiles. */
export type RoutingProfilePage = Schemas["RoutingProfilePage"];

/** An LCR policy (tenant) with its ordered route candidates. */
export type LcrPolicy = Schemas["LcrPolicy"];

/** Cursor-paginated page of LCR policies. */
export type LcrPolicyPage = Schemas["LcrPolicyPage"];
