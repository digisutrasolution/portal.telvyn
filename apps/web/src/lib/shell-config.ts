/**
 * Shell integration seams — the ONLY place the shell reads platform state
 * from. Each field is typed against the future API contract and is replaced
 * by the generated API client when its backing phase lands (contract-first
 * rule, ADR-0002). Values here are honest platform configuration, not mock
 * data: a single un-authenticated operator context on the platform tenant.
 */

export interface TenantContext {
  id: string;
  name: string;
  kind: "platform";
}

export interface RegionContext {
  id: string;
  label: string;
  primary: boolean;
}

export interface SessionContext {
  /** null until authentication ships (Phase 2). */
  user: null;
}

export interface TelemetryContext {
  /** null until monitoring ships (Phases 16/20) — shell renders "no telemetry". */
  health: { tone: "ok" | "warn" | "danger"; label: string; asOf: string } | null;
  /** null until queues exist (Phases 8+) — nav badges hidden. */
  queues: Record<"porting" | "provisioning", number> | null;
  /** Empty until async workflows exist — notifications show an honest empty state. */
  notifications: readonly never[];
}

export const SHELL_CONFIG = {
  product: "Telvyn",
  productSuffix: "DID Portal",
  tenants: [{ id: "platform", name: "Telvyn Platform", kind: "platform" }] as TenantContext[],
  activeTenantId: "platform",
  regions: [{ id: "us-east", label: "US-East", primary: true }] as RegionContext[],
  activeRegionId: "us-east",
  session: { user: null } as SessionContext,
  telemetry: { health: null, queues: null, notifications: [] } as TelemetryContext,
} as const;
