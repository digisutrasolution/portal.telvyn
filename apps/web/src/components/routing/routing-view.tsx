"use client";

import * as React from "react";
import { Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { RoutingProfile } from "@/lib/contracts";
import { listRoutingProfiles, deleteRoutingProfile, type ListRoutingProfilesParams } from "@/lib/telecom/routing-actions";
import { isApiError } from "@/lib/api/problem";
import { messageFor } from "@/components/auth/auth-message";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSession } from "@/lib/session/session-context";
import { ListFilters } from "@/components/telecom/list-filters";
import { RoutingDetailDrawer } from "./routing-detail-drawer";
import { RoutingForm } from "./routing-form";

type FormState = { mode: "create" } | { mode: "edit"; profile: RoutingProfile } | null;

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<RoutingProfile["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };

type Strategy = RoutingProfile["policy"]["selectionStrategy"];
const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DISABLED", label: "Disabled" },
] as const;
const DIRECTION_OPTIONS = [
  { value: "INBOUND", label: "Inbound" },
  { value: "OUTBOUND", label: "Outbound" },
] as const;
const STRATEGY_OPTIONS = [
  { value: "PRIORITY", label: "Priority" },
  { value: "WEIGHTED", label: "Weighted" },
  { value: "ROUND_ROBIN", label: "Round robin" },
  { value: "SIMULTANEOUS", label: "Simultaneous" },
] as const;

function messageFrom(err: unknown, fallback: string): string {
  return isApiError(err) ? err.problem.title : fallback;
}

/**
 * Read-only routing profiles list (Phase 12O-2r). The tenant's own profiles,
 * cursor-paginated with Load more. Declarative config only — nothing is
 * executed. The list shows a per-profile summary (policy + rule count); the full
 * rules belong in a detail drawer (deferred). Gated on `routing.read`; the API
 * auto-scopes to the tenant.
 */
export function RoutingView() {
  const [items, setItems] = React.useState<RoutingProfile[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Mutations (Phase 12O-2ah). Gating is UX-only; the API re-checks every call.
  const { hasPermission } = useSession();
  const canManage = hasPermission("routing.manage");
  const [form, setForm] = React.useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<RoutingProfile | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // Filters (mapped to the already-contracted list query params; "" = no filter).
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"" | RoutingProfile["status"]>("");
  const [direction, setDirection] = React.useState<"" | RoutingProfile["direction"]>("");
  const [strategy, setStrategy] = React.useState<"" | Strategy>("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const params = React.useMemo<ListRoutingProfilesParams>(() => {
    const p: ListRoutingProfilesParams = {};
    if (debouncedSearch) p.q = debouncedSearch;
    if (status) p.status = status;
    if (direction) p.direction = direction;
    if (strategy) p.strategy = strategy;
    return p;
  }, [debouncedSearch, status, direction, strategy]);

  const hasActiveFilters = Boolean(debouncedSearch || status || direction || strategy);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setDirection("");
    setStrategy("");
  }

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listRoutingProfiles(params, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load routing profiles. Please try again."));
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
      const page = await listRoutingProfiles({ ...params, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more routing profiles. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  function refresh() {
    setItems([]);
    setCursor(null);
    setReloadKey((k) => k + 1);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteRoutingProfile(deleteTarget.id);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setDeleteError(messageFor(err));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section aria-labelledby="routing-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="routing-heading" className="font-display text-[19px] font-semibold text-ink">Routing</h1>
          <p className="text-[13px] text-muted">Declarative routing profiles for your workspace. Configuration only — rules are not executed yet.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
          {canManage && (
            <Button variant="primary" size="sm" onClick={() => setForm({ mode: "create" })}>New profile</Button>
          )}
        </div>
      </header>

      {(items.length > 0 || hasActiveFilters) && (
        <ListFilters
          search={{ value: search, onChange: setSearch, label: "Search routing profiles", placeholder: "Search routing profiles…" }}
          selects={[
            { name: "status", label: "Filter by status", value: status, options: STATUS_OPTIONS, allLabel: "All statuses", onChange: (v) => setStatus(v as "" | RoutingProfile["status"]) },
            { name: "direction", label: "Filter by direction", value: direction, options: DIRECTION_OPTIONS, allLabel: "All directions", onChange: (v) => setDirection(v as "" | RoutingProfile["direction"]) },
            { name: "strategy", label: "Filter by strategy", value: strategy, options: STRATEGY_OPTIONS, allLabel: "All strategies", onChange: (v) => setStrategy(v as "" | Strategy) },
          ]}
          canClear={hasActiveFilters}
          onClear={clearFilters}
        />
      )}

      {loading ? (
        <p className="text-[13px] text-muted">Loading routing profiles…</p>
      ) : error && items.length === 0 ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Route aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">
            {hasActiveFilters ? "No routing profiles match your filters." : "No routing profiles are configured yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Direction</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Strategy</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Failover</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Rules</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Version</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{p.name}</td>
                    <td className="px-3 py-2 text-ink-2">{p.direction}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-3 py-2 text-ink-2">{p.policy.selectionStrategy}</td>
                    <td className="px-3 py-2 text-ink-2">{p.policy.failoverEnabled ? "On" : "Off"}</td>
                    <td className="font-num px-3 py-2 text-ink-2">{p.rules.length}</td>
                    <td className="font-num px-3 py-2 text-ink-2">{p.version}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(p.id)} aria-label={`View ${p.name}`}>View</Button>
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

      {detailId && (
        <RoutingDetailDrawer
          key={detailId}
          profileId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(profile) => {
            setDetailId(null);
            setForm({ mode: "edit", profile });
          }}
          onDelete={(profile) => {
            setDetailId(null);
            setDeleteError(null);
            setDeleteTarget(profile);
          }}
        />
      )}

      {form && (
        <RoutingForm {...form} onClose={() => setForm(null)} onSaved={refresh} />
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deletePending && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Delete routing profile</DialogTitle>
          <DialogDescription className="text-[13px] text-ink-2">
            Delete <span className="font-medium text-ink">{deleteTarget?.name}</span>? It is removed from your
            workspace (soft-deleted and retained for audit), along with its rules. This changes configuration only —
            nothing is executed.
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
