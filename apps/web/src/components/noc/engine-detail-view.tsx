"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { Engine, EngineHealth, EngineStatus } from "@/lib/contracts";
import { getEngine, getEngineStatus } from "@/lib/telecom/telecom-actions";
import { useResource } from "@/lib/use-resource";
import { EngineActions } from "./engine-actions";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";

const HEALTH_TONE: Record<EngineHealth["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};
const STATUS_TONE: Record<Engine["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };
const CONN_TONE: Record<EngineStatus["connection"]["state"], Tone> = {
  REACHABLE: "ok",
  UNVERIFIED: "info",
  UNCONFIGURED: "neutral",
  DISABLED: "neutral",
  BLOCKED: "danger",
  UNREACHABLE: "danger",
};
const SYNC_TONE: Record<"NOOP" | "APPLIED" | "PENDING_RECONCILIATION" | "FAILED", Tone> = {
  NOOP: "neutral",
  APPLIED: "ok",
  PENDING_RECONCILIATION: "warn",
  FAILED: "danger",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <dl className="space-y-2 text-[13px]">{children}</dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * Read-only engine detail (ADR-0018): identity + honest health + connection
 * reachability + config-version posture + desired-config summary, from
 * GET /v1/telecom/engines/:id and /:id/status. No mutations.
 */
export function EngineDetailView({ engineId }: { engineId: string }) {
  const loadEngine = React.useCallback((s: AbortSignal) => getEngine(engineId, s), [engineId]);
  const loadStatus = React.useCallback((s: AbortSignal) => getEngineStatus(engineId, s), [engineId]);
  const engine = useResource<Engine>(loadEngine);
  const status = useResource<EngineStatus>(loadStatus);

  const loading = engine.loading || status.loading;
  const error = engine.error ?? status.error;

  return (
    <section aria-labelledby="engine-heading" className="mx-auto max-w-3xl">
      <Link
        href="/infrastructure"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
      >
        <ChevronLeft aria-hidden className="size-4" strokeWidth={1.5} /> Engines
      </Link>

      {loading ? (
        <p className="text-[13px] text-muted">Loading engine…</p>
      ) : error ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">
          {error}
          <Button variant="secondary" size="sm" className="ml-3" onClick={() => { engine.reload(); status.reload(); }}>
            Retry
          </Button>
        </div>
      ) : engine.data && status.data ? (
        <>
          <header className="mb-4 flex flex-wrap items-center gap-2">
            <h1 id="engine-heading" className="font-display text-[19px] font-semibold text-ink">
              {engine.data.name}
            </h1>
            <Badge tone="info">{engine.data.type}</Badge>
            <Badge tone="neutral">{engine.data.environment}</Badge>
            <Badge tone={STATUS_TONE[engine.data.status]}>{engine.data.status}</Badge>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card title="Health">
              <Row label="Status">
                <Status tone={HEALTH_TONE[status.data.health.status]} label={status.data.health.status} />
              </Row>
              {status.data.health.latencyMs !== undefined && (
                <Row label="Latency"><span className="font-num">{status.data.health.latencyMs} ms</span></Row>
              )}
              {status.data.health.detail && <Row label="Detail">{status.data.health.detail}</Row>}
              <Row label="Adapter">{status.data.implemented ? "Implemented" : "Stub (honest UNKNOWN)"}</Row>
            </Card>

            <Card title="Connectivity">
              <Row label="State">
                <Status tone={CONN_TONE[status.data.connection.state]} label={status.data.connection.state} />
              </Row>
              <Row label="Endpoint">{status.data.connection.endpointConfigured ? "Configured" : "Not configured"}</Row>
              {status.data.connection.detail && <Row label="Detail">{status.data.connection.detail}</Row>}
            </Card>

            <Card title="Configuration version">
              <Row label="Desired"><span className="font-num">{status.data.version.desiredVersion ?? "—"}</span></Row>
              <Row label="Applied"><span className="font-num">{status.data.version.appliedVersion ?? "—"}</span></Row>
              <Row label="Sync state">
                {status.data.version.syncState ? (
                  <Badge tone={SYNC_TONE[status.data.version.syncState]}>{status.data.version.syncState}</Badge>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Snapshots"><span className="font-num">{status.data.version.versions}</span></Row>
            </Card>

            <Card title="Desired config">
              <Row label="Version"><span className="font-num">{status.data.desired.version}</span></Row>
              {Object.entries(status.data.desired.summary).map(([kind, count]) => (
                <Row key={kind} label={kind.charAt(0).toUpperCase() + kind.slice(1)}>
                  <span className="font-num">{count}</span>
                </Row>
              ))}
            </Card>
          </div>

          <EngineActions engineId={engineId} onChanged={() => { engine.reload(); status.reload(); }} />
        </>
      ) : null}
    </section>
  );
}
