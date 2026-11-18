"use client";

import * as React from "react";
import { Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { Engine, EngineHealth } from "@/lib/contracts";
import { listEngines } from "@/lib/telecom/telecom-actions";
import { useResource } from "@/lib/use-resource";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";

const HEALTH_TONE: Record<EngineHealth["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};

const STATUS_TONE: Record<Engine["status"], Tone> = {
  ACTIVE: "ok",
  SUSPENDED: "warn",
  DISABLED: "neutral",
};

/**
 * Read-only NOC view: platform telecom engines and their honest health
 * (UNKNOWN for stub adapters — never fabricated). Loads from
 * GET /v1/telecom/engines via the typed client (ADR-0018).
 */
export function EnginesView() {
  const { data, loading, error, reload } = useResource<Engine[]>(listEngines);

  return (
    <section aria-labelledby="engines-heading" className="mx-auto max-w-5xl">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="engines-heading" className="font-display text-[19px] font-semibold text-ink">
            Engines
          </h1>
          <p className="text-[13px] text-muted">Telecom control-plane engines and their current health.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </header>

      {loading ? (
        <p className="text-[13px] text-muted">Loading engines…</p>
      ) : error ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">
          {error}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Server aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">No engines are configured yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Type</th>
                <th scope="col" className="px-3 py-2 font-semibold">Environment</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 font-semibold">Health</th>
                <th scope="col" className="px-3 py-2 font-semibold">Version</th>
              </tr>
            </thead>
            <tbody>
              {data.map((engine) => (
                <tr key={engine.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium text-ink">{engine.name}</td>
                  <td className="px-3 py-2 text-ink-2">{engine.type}</td>
                  <td className="px-3 py-2 text-ink-2">{engine.environment}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[engine.status]}>{engine.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Status tone={HEALTH_TONE[engine.health.status]} label={engine.health.status} />
                  </td>
                  <td className="font-num px-3 py-2 text-ink-2">{engine.version ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
