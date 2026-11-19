"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { LcrPolicy, LcrRoute } from "@/lib/contracts";
import { getLcrPolicy } from "@/lib/telecom/lcr-actions";
import { useResource } from "@/lib/use-resource";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * Cost per minute from integer millionths of a currency unit (never float money).
 * Shows up to 6 fraction digits, trailing zeros trimmed, with the currency code.
 */
function formatCost(costMicros: number, currency: LcrRoute["currency"]): string {
  const value = (costMicros / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
  return `${value || "0"} ${currency}`;
}

/** One route candidate, rendered compactly in the policy's selection order. */
function CandidateCard({ route }: { route: LcrRoute }) {
  return (
    <li className="rounded-md border border-line bg-canvas px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="font-num rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted" title="Priority">#{route.priority}</span>
          <span className="font-mono text-[13px] text-ink">{route.prefix}</span>
          {route.country && <span className="text-[12px] text-muted">{route.country}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-num text-[12px] text-ink" title={`${route.costMicros} micros`}>{formatCost(route.costMicros, route.currency)}</span>
          {!route.enabled && <Badge tone="neutral">Disabled</Badge>}
        </span>
      </div>
      {(route.weight !== null || route.effectiveFrom !== null || route.effectiveTo !== null) && (
        <p className="mt-1 text-[11px] text-muted">
          {route.weight !== null && <span className="mr-3">weight {route.weight}</span>}
          {(route.effectiveFrom !== null || route.effectiveTo !== null) && (
            <span>
              effective {route.effectiveFrom ? route.effectiveFrom.slice(0, 10) : "—"} → {route.effectiveTo ? route.effectiveTo.slice(0, 10) : "—"}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * LCR policy detail (Phase 12O-2x). Fetches the single policy fresh by id via
 * GET /v1/telecom/lcr-policies/{id} and renders what the list only summarized:
 * the full policy plus its complete route candidates, kept in the server's
 * deterministic selection order for the policy's strategy (NOT re-sorted).
 * Declarative route selection only — nothing is executed, rated or billed.
 * Read-only; `routing.read` is re-checked server-side. Mounted keyed by id so
 * each open refetches; a foreign/removed policy surfaces the API's 404 inline.
 */
export function LcrDetailDrawer({ policyId, onClose }: { policyId: string; onClose: () => void }) {
  const fetchPolicy = React.useCallback((s: AbortSignal) => getLcrPolicy(policyId, s), [policyId]);
  const { data, loading, error } = useResource<LcrPolicy>(fetchPolicy);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{data?.name ?? "LCR policy"}</DialogTitle>
        <DialogDescription className="sr-only">LCR policy detail</DialogDescription>

        {loading ? (
          <p className="text-[13px] text-muted">Loading LCR policy…</p>
        ) : error || !data ? (
          <p role="alert" className="text-[13px] text-danger">{error ?? "LCR policy not found."}</p>
        ) : (
          <div className="mt-2 max-h-[70vh] overflow-y-auto pr-1">
            <dl>
              <Row label="Selection strategy">{data.selectionStrategy}</Row>
              <Row label="State"><Badge tone={data.enabled ? "ok" : "neutral"}>{data.enabled ? "Enabled" : "Disabled"}</Badge></Row>
              {data.description && <Row label="Description"><span className="text-ink-2">{data.description}</span></Row>}
              <Row label="Version"><span className="font-num">{data.version}</span></Row>
              <Row label="Created">{data.createdAt.slice(0, 10)}</Row>
              <Row label="Updated">{data.updatedAt.slice(0, 10)}</Row>
            </dl>

            <h3 className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Candidates ({data.candidates.length})
            </h3>
            {data.candidates.length === 0 ? (
              <p className="text-[13px] text-ink-2">No route candidates in this policy.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {data.candidates.map((c) => (
                  <CandidateCard key={c.id} route={c} />
                ))}
              </ol>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
