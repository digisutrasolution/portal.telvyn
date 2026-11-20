"use client";

import * as React from "react";
import { TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LcrPolicy } from "@/lib/contracts";
import { listLcrPolicies, type ListLcrPoliciesParams } from "@/lib/telecom/lcr-actions";
import { isApiError } from "@/lib/api/problem";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ListFilters } from "@/components/telecom/list-filters";
import { LcrDetailDrawer } from "./lcr-detail-drawer";

type Strategy = LcrPolicy["selectionStrategy"];
const STRATEGY_OPTIONS = [
  { value: "LOWEST_COST", label: "Lowest cost" },
  { value: "HIGHEST_PRIORITY", label: "Highest priority" },
  { value: "WEIGHTED", label: "Weighted" },
  { value: "QUALITY_FIRST", label: "Quality first" },
] as const;
// Query booleans travel as strings; "" = no filter, mapped to a real boolean in params.
const ENABLED_OPTIONS = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
] as const;

function messageFrom(err: unknown, fallback: string): string {
  return isApiError(err) ? err.problem.title : fallback;
}

/**
 * Read-only LCR policies list (Phase 12O-2s). The tenant's own least-cost-routing
 * policies, cursor-paginated with Load more. Declarative route selection only —
 * nothing is executed, rated or billed. The list shows a per-policy summary
 * (strategy, enabled, candidate count); the ordered candidates belong in a
 * detail drawer (deferred). Gated on `routing.read`; the API auto-scopes to the
 * tenant.
 */
export function LcrView() {
  const [items, setItems] = React.useState<LcrPolicy[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Filters (mapped to the already-contracted list query params; "" = no filter).
  const [search, setSearch] = React.useState("");
  const [strategy, setStrategy] = React.useState<"" | Strategy>("");
  const [enabled, setEnabled] = React.useState<"" | "true" | "false">("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const params = React.useMemo<ListLcrPoliciesParams>(() => {
    const p: ListLcrPoliciesParams = {};
    if (debouncedSearch) p.q = debouncedSearch;
    if (strategy) p.strategy = strategy;
    if (enabled) p.enabled = enabled === "true";
    return p;
  }, [debouncedSearch, strategy, enabled]);

  const hasActiveFilters = Boolean(debouncedSearch || strategy || enabled);

  function clearFilters() {
    setSearch("");
    setStrategy("");
    setEnabled("");
  }

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    listLcrPolicies(params, ac.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFrom(err, "Couldn't load LCR policies. Please try again."));
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
      const page = await listLcrPolicies({ ...params, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageFrom(err, "Couldn't load more LCR policies. Please try again."));
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
    <section aria-labelledby="lcr-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="lcr-heading" className="font-display text-[19px] font-semibold text-ink">LCR</h1>
          <p className="text-[13px] text-muted">Least-cost-routing policies for your workspace. Configuration only — candidates are not executed or rated yet.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
      </header>

      {(items.length > 0 || hasActiveFilters) && (
        <ListFilters
          search={{ value: search, onChange: setSearch, label: "Search LCR policies", placeholder: "Search LCR policies…" }}
          selects={[
            { name: "strategy", label: "Filter by strategy", value: strategy, options: STRATEGY_OPTIONS, allLabel: "All strategies", onChange: (v) => setStrategy(v as "" | Strategy) },
            { name: "enabled", label: "Filter by state", value: enabled, options: ENABLED_OPTIONS, allLabel: "Any state", onChange: (v) => setEnabled(v as "" | "true" | "false") },
          ]}
          canClear={hasActiveFilters}
          onClear={clearFilters}
        />
      )}

      {loading ? (
        <p className="text-[13px] text-muted">Loading LCR policies…</p>
      ) : error && items.length === 0 ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <TrendingDown aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">
            {hasActiveFilters ? "No LCR policies match your filters." : "No LCR policies are configured yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Strategy</th>
                  <th scope="col" className="px-3 py-2 font-semibold">State</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Candidates</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Version</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{p.name}</td>
                    <td className="px-3 py-2 text-ink-2">{p.selectionStrategy}</td>
                    <td className="px-3 py-2"><Badge tone={p.enabled ? "ok" : "neutral"}>{p.enabled ? "Enabled" : "Disabled"}</Badge></td>
                    <td className="font-num px-3 py-2 text-ink-2">{p.candidates.length}</td>
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

      {detailId && <LcrDetailDrawer key={detailId} policyId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}
