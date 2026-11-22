"use client";

import * as React from "react";
import { Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import type { Carrier } from "@/lib/contracts";
import { listCarriers, deleteCarrier, checkCarrierHealth, type ListCarriersParams } from "@/lib/telecom/carriers-actions";
import { isApiError } from "@/lib/api/problem";
import { messageFor } from "@/components/auth/auth-message";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSession } from "@/lib/session/session-context";
import { ListFilters } from "@/components/telecom/list-filters";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CarrierDetailDrawer } from "./carrier-detail-drawer";
import { CarrierForm } from "./carrier-form";
import { CarrierHealthHistoryDialog } from "./carrier-health-history-dialog";

type FormState = { mode: "create" } | { mode: "edit"; carrier: Carrier } | null;

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

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DISABLED", label: "Disabled" },
] as const;
const SCOPE_OPTIONS = [
  { value: "tenant", label: "Tenant" },
  { value: "system", label: "System" },
] as const;

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
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Mutations (Phase 12O-2ae). Gating is UX-only; the API re-checks every call.
  const { hasPermission } = useSession();
  const canCreate = hasPermission("carrier.create");
  const canCheckHealth = hasPermission("telecom.health.read");
  const [form, setForm] = React.useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Carrier | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // Operator health probe (Phase 12O-2aw). Gating is UX-only; the API re-checks.
  const [checkingId, setCheckingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [historyCarrier, setHistoryCarrier] = React.useState<Carrier | null>(null); // Phase 12O-2ax

  // Filters (mapped to the already-contracted list query params; "" = no filter).
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"" | Carrier["status"]>("");
  const [scope, setScope] = React.useState<"" | "system" | "tenant">("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const params = React.useMemo<ListCarriersParams>(() => {
    const p: ListCarriersParams = {};
    if (debouncedSearch) p.q = debouncedSearch;
    if (status) p.status = status;
    if (scope) p.scope = scope;
    return p;
  }, [debouncedSearch, status, scope]);

  const hasActiveFilters = Boolean(debouncedSearch || status || scope);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setScope("");
  }

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listCarriers(params, ac.signal)
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
  }, [params, reloadKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listCarriers({ ...params, cursor });
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

  async function checkHealth(carrierId: string) {
    setCheckingId(carrierId);
    setActionError(null);
    try {
      await checkCarrierHealth(carrierId);
      refresh(); // re-read so the Health column reflects the probe
    } catch (err) {
      setActionError(messageFor(err));
    } finally {
      setCheckingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteCarrier(deleteTarget.id);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setDeleteError(messageFor(err));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section aria-labelledby="carriers-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="carriers-heading" className="font-display text-[19px] font-semibold text-ink">Carriers</h1>
          <p className="text-[13px] text-muted">Upstream carriers available to your workspace, including shared system carriers.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setForm({ mode: "create" })}>New carrier</Button>
          )}
        </div>
      </header>

      {(items.length > 0 || hasActiveFilters) && (
        <ListFilters
          search={{ value: search, onChange: setSearch, label: "Search carriers", placeholder: "Search carriers…" }}
          selects={[
            { name: "status", label: "Filter by status", value: status, options: STATUS_OPTIONS, allLabel: "All statuses", onChange: (v) => setStatus(v as "" | Carrier["status"]) },
            { name: "scope", label: "Filter by scope", value: scope, options: SCOPE_OPTIONS, allLabel: "All scopes", onChange: (v) => setScope(v as "" | "system" | "tenant") },
          ]}
          canClear={hasActiveFilters}
          onClear={clearFilters}
        />
      )}

      {loading ? (
        <p className="text-[13px] text-muted">Loading carriers…</p>
      ) : error && items.length === 0 ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Waypoints aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">
            {hasActiveFilters ? "No carriers match your filters." : "No carriers are configured yet."}
          </p>
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
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
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
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex gap-1">
                        {canCheckHealth && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setHistoryCarrier(c)} aria-label={`Health history of ${c.name}`}>History</Button>
                            <Button variant="ghost" size="sm" onClick={() => checkHealth(c.id)} disabled={checkingId === c.id} aria-label={`Check health of ${c.name}`}>
                              {checkingId === c.id ? "Checking…" : "Check"}
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setDetailId(c.id)} aria-label={`View ${c.name}`}>View</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>
          )}

          {actionError && (
            <p role="alert" className="mt-3 text-[12px] text-danger">{actionError}</p>
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

      {detailId && (
        <CarrierDetailDrawer
          key={detailId}
          carrierId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(carrier) => {
            setDetailId(null);
            setForm({ mode: "edit", carrier });
          }}
          onDelete={(carrier) => {
            setDetailId(null);
            setDeleteError(null);
            setDeleteTarget(carrier);
          }}
        />
      )}

      {form && (
        <CarrierForm {...form} onClose={() => setForm(null)} onSaved={refresh} />
      )}

      {historyCarrier && (
        <CarrierHealthHistoryDialog key={historyCarrier.id} carrier={historyCarrier} onClose={() => setHistoryCarrier(null)} />
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deletePending && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Delete carrier</DialogTitle>
          <DialogDescription className="text-[13px] text-ink-2">
            Delete <span className="font-medium text-ink">{deleteTarget?.name}</span>? It is removed from your
            workspace (soft-deleted and retained for audit). SIP trunks or numbers that reference it are not changed.
          </DialogDescription>
          {deleteError && (
            <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {deleteError}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={deletePending}>Cancel</Button>
            <Button type="button" variant="danger" size="sm" onClick={confirmDelete} disabled={deletePending}>
              {deletePending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
