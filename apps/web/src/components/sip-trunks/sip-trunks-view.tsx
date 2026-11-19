"use client";

import * as React from "react";
import { Cable } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { SipTrunk } from "@/lib/contracts";
import { listSipTrunks } from "@/lib/telecom/sip-trunks-actions";
import { isApiError } from "@/lib/api/problem";
import { SipTrunkDetailDrawer } from "./sip-trunk-detail-drawer";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<SipTrunk["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };
const HEALTH_TONE: Record<SipTrunk["health"]["status"], Tone> = {
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
 * Read-only SIP trunks list (Phase 12O-2p). The tenant's own trunks,
 * cursor-paginated with Load more. Control-plane config only — health is honest
 * UNKNOWN (no live connectivity). Secrets never appear. The route/nav gate on
 * `sip_trunk.read` (ADR-0017); the API re-checks and auto-scopes to the tenant.
 */
export function SipTrunksView() {
  const [items, setItems] = React.useState<SipTrunk[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listSipTrunks({}, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load SIP trunks. Please try again."));
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
      const page = await listSipTrunks({ cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more SIP trunks. Please try again."));
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
    <section aria-labelledby="sip-trunks-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="sip-trunks-heading" className="font-display text-[19px] font-semibold text-ink">SIP trunks</h1>
          <p className="text-[13px] text-muted">Connectivity configuration for your workspace. No live connectivity — health is reported once probes exist.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
      </header>

      {loading ? (
        <p className="text-[13px] text-muted">Loading SIP trunks…</p>
      ) : error && items.length === 0 ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Cable aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">No SIP trunks are configured yet.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Carrier</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Direction</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Transport</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Endpoint</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Health</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{t.name}</td>
                    <td className="px-3 py-2 text-ink-2">{t.carrier?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-2">{t.direction}</td>
                    <td className="px-3 py-2 text-ink-2">{t.transport}{t.tls ? " · TLS" : ""}</td>
                    <td className="px-3 py-2 text-ink-2">{t.host ?? t.sipUri ?? "—"}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></td>
                    <td className="px-3 py-2"><Status tone={HEALTH_TONE[t.health.status]} label={t.health.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(t.id)} aria-label={`View ${t.name}`}>View</Button>
                    </td>
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

      {detailId && <SipTrunkDetailDrawer key={detailId} trunkId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}
