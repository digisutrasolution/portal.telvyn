"use client";

import * as React from "react";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { HealthEvent } from "@/lib/contracts";
import { listEngineHealthEvents } from "@/lib/telecom/telecom-actions";
import { isApiError } from "@/lib/api/problem";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const HEALTH_TONE: Record<HealthEvent["toStatus"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};

function messageFrom(err: unknown, fallback: string): string {
  return isApiError(err) ? err.problem.title : fallback;
}

/**
 * Engine health-event history (Phase 12O-2as) — the append-only timeline of this
 * engine's honest status transitions, newest first, from
 * GET /v1/telecom/engines/{id}/health-events. Self-contained (its own load / error /
 * Load more) so it never blocks the engine detail render. Read-only; the route is
 * already platform + `telecom.health.read` gated and the API re-checks.
 */
export function EngineHealthHistory({ engineId }: { engineId: string }) {
  const [items, setItems] = React.useState<HealthEvent[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listEngineHealthEvents(engineId, {}, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load health history. Please try again."));
        setLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [engineId]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listEngineHealthEvents(engineId, { cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more health history. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="engine-health-history-heading" className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h2 id="engine-health-history-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Health history
      </h2>

      {loading ? (
        <p className="text-[13px] text-muted">Loading health history…</p>
      ) : error && items.length === 0 ? (
        <p role="alert" className="text-[13px] text-danger">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-2">No health events recorded yet.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {items.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
                <div className="flex items-center gap-2 text-[13px]">
                  {e.fromStatus && (
                    <>
                      <Status tone={HEALTH_TONE[e.fromStatus]} label={e.fromStatus} />
                      <span aria-hidden className="text-muted">→</span>
                    </>
                  )}
                  <Status tone={HEALTH_TONE[e.toStatus]} label={e.toStatus} />
                  {e.reason && <span className="text-[12px] text-muted">{e.reason}</span>}
                </div>
                <time className="shrink-0 text-[12px] text-muted" dateTime={e.createdAt} title={e.createdAt}>
                  {e.createdAt.slice(0, 16).replace("T", " ")}
                </time>
              </li>
            ))}
          </ol>

          {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}

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
