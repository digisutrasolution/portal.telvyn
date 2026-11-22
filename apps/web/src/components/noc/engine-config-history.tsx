"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConfigVersion } from "@/lib/contracts";
import { listEngineConfigVersions } from "@/lib/telecom/telecom-actions";
import { isApiError } from "@/lib/api/problem";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const CHANGE_TONE: Record<ConfigVersion["changeType"], Tone> = {
  CREATE: "info",
  UPDATE: "neutral",
  DELETE: "danger",
  STATUS_CHANGE: "warn",
};
const KIND_TONE: Record<NonNullable<ConfigVersion["kind"]>, Tone> = {
  desired: "info",
  applied: "ok",
  reconcile_pending: "warn",
};

function messageFrom(err: unknown, fallback: string): string {
  return isApiError(err) ? err.problem.title : fallback;
}

/**
 * Engine config-version history (Phase 12O-2at) — the append-only timeline of the
 * engine's desired/applied configuration versions (recorded by sync / rollback),
 * newest first, from GET /v1/telecom/engines/{id}/config-versions. Snapshots are
 * secret-free (short fingerprint + resource-count summary only). Self-contained
 * (own load / error / Load more) so it never blocks the engine detail render.
 * Read-only; the route is already platform + `telecom.health.read` gated.
 */
export function EngineConfigHistory({ engineId }: { engineId: string }) {
  const [items, setItems] = React.useState<ConfigVersion[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listEngineConfigVersions(engineId, {}, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load config history. Please try again."));
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
      const page = await listEngineConfigVersions(engineId, { cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more config history. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="engine-config-history-heading" className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h2 id="engine-config-history-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Config version history
      </h2>

      {loading ? (
        <p className="text-[13px] text-muted">Loading config history…</p>
      ) : error && items.length === 0 ? (
        <p role="alert" className="text-[13px] text-danger">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-2">No configuration versions recorded yet.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {items.map((v) => (
              <li key={v.id} className="border-b border-line py-2 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Badge tone={CHANGE_TONE[v.changeType]}>{v.changeType}</Badge>
                    {v.kind && <Badge tone={KIND_TONE[v.kind]}>{v.kind}</Badge>}
                    {v.version && (
                      <span className="font-mono text-[12px] text-ink">
                        {v.previousVersion && <span className="text-muted">{v.previousVersion} → </span>}
                        {v.version}
                      </span>
                    )}
                  </div>
                  <time className="shrink-0 text-[12px] text-muted" dateTime={v.createdAt} title={v.createdAt}>
                    {v.createdAt.slice(0, 16).replace("T", " ")}
                  </time>
                </div>
                {v.summary && Object.keys(v.summary).length > 0 && (
                  <p className="mt-1 text-[11px] text-muted">
                    {Object.entries(v.summary).map(([k, n], i) => (
                      <span key={k}>
                        {i > 0 && " · "}
                        {k} <span className="font-num text-ink-2">{n}</span>
                      </span>
                    ))}
                  </p>
                )}
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
