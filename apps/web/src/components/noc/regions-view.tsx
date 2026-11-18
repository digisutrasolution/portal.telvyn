"use client";

import * as React from "react";
import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Region } from "@/lib/contracts";
import { listRegions } from "@/lib/telecom/telecom-actions";
import { useResource } from "@/lib/use-resource";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<Region["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };

/** Read-only NOC view: telecom regions (ADR-0018). */
export function RegionsView() {
  const { data, loading, error, reload } = useResource<Region[]>(listRegions);

  return (
    <section aria-labelledby="regions-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="regions-heading" className="font-display text-[19px] font-semibold text-ink">Regions</h1>
          <p className="text-[13px] text-muted">Telecom regions and failover topology.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>Refresh</Button>
      </header>

      {loading ? (
        <p className="text-[13px] text-muted">Loading regions…</p>
      ) : error ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : !data || data.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Globe aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">No regions are configured yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">Code</th>
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Country</th>
                <th scope="col" className="px-3 py-2 font-semibold">Timezone</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((region) => (
                <tr key={region.id} className="border-b border-line last:border-0">
                  <td className="font-num px-3 py-2 text-ink">{region.code}</td>
                  <td className="px-3 py-2 font-medium text-ink">{region.name}</td>
                  <td className="px-3 py-2 text-ink-2">{region.country}</td>
                  <td className="px-3 py-2 text-ink-2">{region.timezone}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[region.status]}>{region.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
