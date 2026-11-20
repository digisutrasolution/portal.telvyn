"use client";

import * as React from "react";
import { Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { Did } from "@/lib/contracts";
import { listDids, type ListDidsParams } from "@/lib/telecom/dids-actions";
import { isApiError } from "@/lib/api/problem";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ListFilters } from "@/components/telecom/list-filters";
import { NumberDetailDrawer } from "./number-detail-drawer";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<Did["status"], Tone> = {
  AVAILABLE: "neutral",
  RESERVED: "info",
  ASSIGNED: "info",
  ACTIVE: "ok",
  SUSPENDED: "warn",
  PORTING: "warn",
  RELEASED: "neutral",
};

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "RESERVED", label: "Reserved" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "PORTING", label: "Porting" },
  { value: "RELEASED", label: "Released" },
] as const;
const HEALTH_TONE: Record<Did["health"]["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};

function messageFrom(err: unknown, fallback: string): string {
  return isApiError(err) ? err.problem.title : fallback;
}

/** Short reference for a related id (names aren't returned by the DID API). */
function Ref({ id }: { id: string | null }) {
  if (!id) return <span className="text-muted">—</span>;
  return (
    <span className="font-mono text-[12px] text-ink-2" title={id}>
      {id.slice(0, 8)}
    </span>
  );
}

/**
 * Read-only DID (Numbers) inventory (Phase 12O-2q). The tenant's own numbers,
 * cursor-paginated with Load more. Control-plane only — health is honest UNKNOWN
 * (no live SIP-path check). The DID API returns reference ids only (no names), so
 * carrier/trunk show as short refs. Gated on `did.read`; the API auto-scopes to
 * the tenant.
 */
export function NumbersView() {
  const [items, setItems] = React.useState<Did[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Filters (mapped to the already-contracted list query params; "" = no filter).
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"" | Did["status"]>("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const params = React.useMemo<ListDidsParams>(() => {
    const p: ListDidsParams = {};
    if (debouncedSearch) p.q = debouncedSearch;
    if (status) p.status = status;
    return p;
  }, [debouncedSearch, status]);

  const hasActiveFilters = Boolean(debouncedSearch || status);

  function clearFilters() {
    setSearch("");
    setStatus("");
  }

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listDids(params, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load numbers. Please try again."));
        setLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [params, reloadKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listDids({ ...params, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more numbers. Please try again."));
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
    <section aria-labelledby="numbers-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="numbers-heading" className="font-display text-[19px] font-semibold text-ink">Numbers</h1>
          <p className="text-[13px] text-muted">Your DID inventory and its lifecycle status.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
      </header>

      {(items.length > 0 || hasActiveFilters) && (
        <ListFilters
          search={{ value: search, onChange: setSearch, label: "Search numbers", placeholder: "Search by number…" }}
          selects={[
            { name: "status", label: "Filter by status", value: status, options: STATUS_OPTIONS, allLabel: "All statuses", onChange: (v) => setStatus(v as "" | Did["status"]) },
          ]}
          canClear={hasActiveFilters}
          onClear={clearFilters}
        />
      )}

      {loading ? (
        <p className="text-[13px] text-muted">Loading numbers…</p>
      ) : error && items.length === 0 ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Hash aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">
            {hasActiveFilters ? "No numbers match your filters." : "No numbers in your inventory yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Number</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Country</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Carrier</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Trunk</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Assigned</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Health</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-mono font-medium text-ink">{d.e164}</td>
                    <td className="px-3 py-2 text-ink-2">{d.country}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge></td>
                    <td className="px-3 py-2"><Ref id={d.carrierId} /></td>
                    <td className="px-3 py-2"><Ref id={d.sipTrunkId} /></td>
                    <td className="px-3 py-2 text-ink-2">{d.assignedAt ? d.assignedAt.slice(0, 10) : "—"}</td>
                    <td className="px-3 py-2"><Status tone={HEALTH_TONE[d.health.status]} label={d.health.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(d.id)} aria-label={`View ${d.e164}`}>View</Button>
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

      {detailId && <NumberDetailDrawer key={detailId} didId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}
