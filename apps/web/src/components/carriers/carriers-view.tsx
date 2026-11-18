"use client";

import * as React from "react";
import { Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { Carrier } from "@/lib/contracts";
import { listCarriers } from "@/lib/telecom/carriers-actions";
import { isApiError } from "@/lib/api/problem";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<Carrier["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };
const HEALTH_TONE: Record<Carrier["health"]["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};
const SCOPE_TONE: Record<Carrier["scope"], Tone> = { SYSTEM: "info", TENANT: "neutral" };

function messageFrom(err: unknown, fallback: string): string {
  return isApiError(err) ? err.problem.title : fallback;
}

/**
 * Read-only carriers list (Phase 12O-2o). Shows the session's visible carriers
 * (own + system), cursor-paginated with Load more. Health is honest (UNKNOWN —
 * no carrier probe exists yet). Secrets never appear. The route/nav gate on
 * `carrier.read` (ADR-0017); the API re-checks on every request.
 */
export function CarriersView() {
  const [items, setItems] = React.useState<Carrier[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listCarriers({}, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load carriers. Please try again."));
        setLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [reloadKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listCarriers({ cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more carriers. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  function refresh() {
    setItems([]);
    setCursor(null);
    setReloadKey((k) => k + 1);
  }

  return (
    <section aria-labelledby="carriers-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="carriers-heading" className="font-display text-[19px] font-semibold text-ink">Carriers</h1>
          <p className="text-[13px] text-muted">Upstream carriers available to your workspace, including shared system carriers.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
      </header>

      {loading ? (
        <p className="text-[13px] text-muted">Loading carriers…</p>
      ) : error && items.length === 0 ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Waypoints aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">No carriers are configured yet.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Scope</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Type</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Country</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Codecs</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Health</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{c.name}</td>
                    <td className="px-3 py-2"><Badge tone={SCOPE_TONE[c.scope]}>{c.scope}</Badge></td>
                    <td className="px-3 py-2 text-ink-2">{c.type ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-2">{c.country ?? "—"}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge></td>
                    <td className="px-3 py-2 text-ink-2">{c.codecs.length > 0 ? c.codecs.join(", ") : "—"}</td>
                    <td className="px-3 py-2"><Status tone={HEALTH_TONE[c.health.status]} label={c.health.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>
          )}

          {cursor && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
