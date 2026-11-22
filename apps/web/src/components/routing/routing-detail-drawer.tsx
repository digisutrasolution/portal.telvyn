"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { RoutingProfile, RoutingRule } from "@/lib/contracts";
import { getRoutingProfile } from "@/lib/telecom/routing-actions";
import { useResource } from "@/lib/use-resource";
import { useSession } from "@/lib/session/session-context";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<RoutingProfile["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** One rule, rendered compactly in priority order. Config only — nothing is dialled. */
function RuleCard({ rule }: { rule: RoutingRule }) {
  return (
    <li className="rounded-md border border-line bg-canvas px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="font-num rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted" title="Priority">#{rule.priority}</span>
          <span className="text-[12px] text-muted">{rule.destinationType}</span>
        </span>
        {!rule.enabled && <Badge tone="neutral">Disabled</Badge>}
      </div>
      <p className="mt-1 break-all font-mono text-[12px] text-ink">{rule.destination}</p>
      {(rule.weight !== null || rule.timeoutSeconds !== null || rule.failoverDestination !== null) && (
        <p className="mt-1 text-[11px] text-muted">
          {rule.weight !== null && <span className="mr-3">weight {rule.weight}</span>}
          {rule.timeoutSeconds !== null && <span className="mr-3">timeout {rule.timeoutSeconds}s</span>}
          {rule.failoverDestination !== null && (
            <span>failover → <span className="font-mono text-ink-2">{rule.failoverDestination}</span></span>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * Routing profile detail (Phase 12O-2w). Fetches the single profile fresh by id
 * via GET /v1/telecom/routing-profiles/{id} and renders what the list only
 * summarizes: the full selection/failover policy and the complete ordered rule
 * set (priority ASC). Declarative config only — nothing is executed. Read-only;
 * `routing.read` is re-checked server-side. Mounted keyed by id so each open
 * refetches; a foreign/removed profile surfaces the API's 404 inline. Edit /
 * Delete appear only with `routing.manage` (UX gating; the API re-checks) and hand
 * the loaded profile back to the parent; editing never touches the rule set.
 */
export function RoutingDetailDrawer({
  profileId,
  onClose,
  onEdit,
  onDelete,
}: {
  profileId: string;
  onClose: () => void;
  /** Open the edit form for this profile (shown only with `routing.manage`). */
  onEdit?: (profile: RoutingProfile) => void;
  /** Request deletion of this profile (shown only with `routing.manage`). */
  onDelete?: (profile: RoutingProfile) => void;
}) {
  const { hasPermission } = useSession();
  const fetchProfile = React.useCallback((s: AbortSignal) => getRoutingProfile(profileId, s), [profileId]);
  const { data, loading, error } = useResource<RoutingProfile>(fetchProfile);

  const canManage = hasPermission("routing.manage");
  const canEdit = Boolean(onEdit) && canManage;
  const canDelete = Boolean(onDelete) && canManage;

  const rules = React.useMemo(
    () => (data ? [...data.rules].sort((a, b) => a.priority - b.priority) : []),
    [data],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{data?.name ?? "Routing profile"}</DialogTitle>
        <DialogDescription className="sr-only">Routing profile detail</DialogDescription>

        {loading ? (
          <p className="text-[13px] text-muted">Loading routing profile…</p>
        ) : error || !data ? (
          <p role="alert" className="text-[13px] text-danger">{error ?? "Routing profile not found."}</p>
        ) : (
          <div className="mt-2 max-h-[70vh] overflow-y-auto pr-1">
            <dl>
              <Row label="Direction">{data.direction}</Row>
              <Row label="Status"><Badge tone={STATUS_TONE[data.status]}>{data.status}</Badge></Row>
              {data.description && <Row label="Description"><span className="text-ink-2">{data.description}</span></Row>}
              <Row label="Selection strategy">{data.policy.selectionStrategy}</Row>
              <Row label="Failover">{data.policy.failoverEnabled ? "On" : "Off"}</Row>
              <Row label="Failover conditions">
                {data.policy.failoverConditions.length > 0 ? data.policy.failoverConditions.join(", ") : "—"}
              </Row>
              <Row label="Max attempts"><span className="font-num">{data.policy.maxAttempts ?? "—"}</span></Row>
              <Row label="Overall timeout"><span className="font-num">{data.policy.overallTimeoutSeconds ?? "—"}</span>{data.policy.overallTimeoutSeconds !== null ? "s" : ""}</Row>
              <Row label="Version"><span className="font-num">{data.version}</span></Row>
              <Row label="Created">{data.createdAt.slice(0, 10)}</Row>
              <Row label="Updated">{data.updatedAt.slice(0, 10)}</Row>
            </dl>

            <h3 className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Rules ({rules.length})
            </h3>
            {rules.length === 0 ? (
              <p className="text-[13px] text-ink-2">No rules in this profile.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {rules.map((r) => (
                  <RuleCard key={r.id} rule={r} />
                ))}
              </ol>
            )}
          </div>
        )}

        {data && (canEdit || canDelete) && (
          <div className="mt-4 flex justify-end gap-2">
            {canDelete && (
              <Button variant="danger" size="sm" onClick={() => onDelete!(data)}>Delete</Button>
            )}
            {canEdit && (
              <Button variant="primary" size="sm" onClick={() => onEdit!(data)}>Edit</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
