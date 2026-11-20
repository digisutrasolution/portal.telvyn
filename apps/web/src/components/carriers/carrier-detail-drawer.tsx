"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Carrier } from "@/lib/contracts";
import { getCarrier } from "@/lib/telecom/carriers-actions";
import { useResource } from "@/lib/use-resource";
import { useSession } from "@/lib/session/session-context";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * Carrier detail (Phase 12O-2t). Fetches the single carrier fresh by id via
 * GET /v1/telecom/carriers/{id} (honest UNKNOWN health; credential shown as a
 * non-secret reference only). Read-only; `carrier.read` is re-checked server-side.
 * Mounted keyed by id so each open refetches; a foreign/removed carrier surfaces
 * the API's 404 as an inline message.
 */
export function CarrierDetailDrawer({
  carrierId,
  onClose,
  onEdit,
  onDelete,
}: {
  carrierId: string;
  onClose: () => void;
  /** Open the edit form for this carrier (shown only with `carrier.update`). */
  onEdit?: (carrier: Carrier) => void;
  /** Request deletion of this carrier (shown only with `carrier.delete`). */
  onDelete?: (carrier: Carrier) => void;
}) {
  const { hasPermission } = useSession();
  const fetchCarrier = React.useCallback((s: AbortSignal) => getCarrier(carrierId, s), [carrierId]);
  const { data, loading, error } = useResource<Carrier>(fetchCarrier);

  const canEdit = Boolean(onEdit) && hasPermission("carrier.update");
  const canDelete = Boolean(onDelete) && hasPermission("carrier.delete");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{data?.name ?? "Carrier"}</DialogTitle>
        <DialogDescription className="sr-only">Carrier detail</DialogDescription>

        {loading ? (
          <p className="text-[13px] text-muted">Loading carrier…</p>
        ) : error || !data ? (
          <p role="alert" className="text-[13px] text-danger">{error ?? "Carrier not found."}</p>
        ) : (
          <dl className="mt-2">
            <Row label="Scope"><Badge tone={SCOPE_TONE[data.scope]}>{data.scope}</Badge></Row>
            <Row label="Type">{data.type ?? "—"}</Row>
            <Row label="Country">{data.country ?? "—"}</Row>
            <Row label="Status"><Badge tone={STATUS_TONE[data.status]}>{data.status}</Badge></Row>
            <Row label="Health"><Status tone={HEALTH_TONE[data.health.status]} label={data.health.status} /></Row>
            <Row label="Priority"><span className="font-num">{data.priority ?? "—"}</span></Row>
            <Row label="Codecs">{data.codecs.length > 0 ? data.codecs.join(", ") : "—"}</Row>
            <Row label="Max CPS"><span className="font-num">{data.maxCps ?? "—"}</span></Row>
            <Row label="Max concurrent calls"><span className="font-num">{data.maxConcurrentCalls ?? "—"}</span></Row>
            <Row label="Credential">
              {data.credential ? (
                <span>
                  {data.credential.label}{" "}
                  <span className="text-muted">({data.credential.type} · {data.credential.scope})</span>
                </span>
              ) : (
                "None"
              )}
            </Row>
            <Row label="Created">{data.createdAt.slice(0, 10)}</Row>
            <Row label="Updated">{data.updatedAt.slice(0, 10)}</Row>
          </dl>
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
