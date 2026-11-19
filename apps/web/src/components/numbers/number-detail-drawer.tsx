"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Did } from "@/lib/contracts";
import { getDid } from "@/lib/telecom/dids-actions";
import { useResource } from "@/lib/use-resource";

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
const HEALTH_TONE: Record<Did["health"]["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** Full related-resource id (the DID API returns reference ids only — never names). */
function RefId({ id }: { id: string | null }) {
  if (!id) return <span className="text-muted">—</span>;
  return <span className="font-mono text-[12px] text-ink-2">{id}</span>;
}

/**
 * DID (number) detail (Phase 12O-2v). Fetches the single DID fresh by id via
 * GET /v1/telecom/dids/{id} (control-plane only; honest UNKNOWN health — no live
 * SIP-path check). Related resources are shown as reference ids only (the API
 * never embeds objects). Read-only; `did.read` is re-checked server-side. Mounted
 * keyed by id so each open refetches; a foreign/pool/removed number surfaces the
 * API's 404 inline.
 */
export function NumberDetailDrawer({ didId, onClose }: { didId: string; onClose: () => void }) {
  const fetchDid = React.useCallback((s: AbortSignal) => getDid(didId, s), [didId]);
  const { data, loading, error } = useResource<Did>(fetchDid);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle className="font-mono">{data?.e164 ?? "Number"}</DialogTitle>
        <DialogDescription className="sr-only">DID detail</DialogDescription>

        {loading ? (
          <p className="text-[13px] text-muted">Loading number…</p>
        ) : error || !data ? (
          <p role="alert" className="text-[13px] text-danger">{error ?? "Number not found."}</p>
        ) : (
          <dl className="mt-2">
            <Row label="Country">{data.country}</Row>
            <Row label="Status"><Badge tone={STATUS_TONE[data.status]}>{data.status}</Badge></Row>
            <Row label="Health"><Status tone={HEALTH_TONE[data.health.status]} label={data.health.status} /></Row>
            <Row label="Carrier"><RefId id={data.carrierId} /></Row>
            <Row label="SIP trunk"><RefId id={data.sipTrunkId} /></Row>
            <Row label="Routing profile"><RefId id={data.routingProfileId} /></Row>
            <Row label="Region"><RefId id={data.regionId} /></Row>
            <Row label="Assigned">{data.assignedAt ? data.assignedAt.slice(0, 10) : "—"}</Row>
            <Row label="Created">{data.createdAt.slice(0, 10)}</Row>
            <Row label="Updated">{data.updatedAt.slice(0, 10)}</Row>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
