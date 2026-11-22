"use client";

import * as React from "react";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Carrier, HealthEvent } from "@/lib/contracts";
import { listCarrierHealthEvents } from "@/lib/telecom/carriers-actions";
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
 * Carrier health-event history (Phase 12O-2ax) — the append-only timeline of a
 * carrier's status transitions (produced by the operator probe, Phase 12O-2aw),
 * newest first, from GET /v1/telecom/carriers/{id}/health-events. Shown in a dialog
 * from the Carriers list (carriers have no detail page). Own load / error / Load
 * more. Read-only; the route is `telecom.health.read` gated and the API re-checks.
 */
export function CarrierHealthHistoryDialog({ carrier, onClose }: { carrier: Carrier; onClose: () => void }) {
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
    listCarrierHealthEvents(carrier.id, {}, ac.signal)
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
  }, [carrier.id]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listCarrierHealthEvents(carrier.id, { cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more health history. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogTitle>Health history — {carrier.name}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          Status transitions for this carrier, newest first.
        </DialogDescription>

        <div className="mt-3">
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
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
