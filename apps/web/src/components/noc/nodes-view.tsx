"use client";

import * as React from "react";
import { Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { Node } from "@/lib/contracts";
import { listNodes } from "@/lib/telecom/telecom-actions";
import { useResource } from "@/lib/use-resource";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<Node["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };
const HEALTH_TONE: Record<Node["health"]["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};

/** Read-only NOC view: telecom nodes with heartbeat health (ADR-0018). */
export function NodesView() {
  const { data, loading, error, reload } = useResource<Node[]>(listNodes);

  return (
    <section aria-labelledby="nodes-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="nodes-heading" className="font-display text-[19px] font-semibold text-ink">Nodes</h1>
          <p className="text-[13px] text-muted">Engine nodes and their last heartbeat health.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>Refresh</Button>
      </header>

      {loading ? (
        <p className="text-[13px] text-muted">Loading nodes…</p>
      ) : error ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : !data || data.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Boxes aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">No nodes are configured yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Environment</th>
                <th scope="col" className="px-3 py-2 font-semibold">Zone</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 font-semibold">Health</th>
                <th scope="col" className="px-3 py-2 font-semibold">Version</th>
              </tr>
            </thead>
            <tbody>
              {data.map((node) => (
                <tr key={node.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium text-ink">{node.name}</td>
                  <td className="px-3 py-2 text-ink-2">{node.environment}</td>
                  <td className="px-3 py-2 text-ink-2">{node.zone ?? "—"}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[node.status]}>{node.status}</Badge></td>
                  <td className="px-3 py-2"><Status tone={HEALTH_TONE[node.health.status]} label={node.health.status} /></td>
                  <td className="font-num px-3 py-2 text-ink-2">{node.version ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
