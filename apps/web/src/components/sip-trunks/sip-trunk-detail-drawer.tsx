"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Status } from "@/components/ui/status";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { SipTrunk } from "@/lib/contracts";
import { getSipTrunk } from "@/lib/telecom/sip-trunks-actions";
import { useResource } from "@/lib/use-resource";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const STATUS_TONE: Record<SipTrunk["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn", DISABLED: "neutral" };
const HEALTH_TONE: Record<SipTrunk["health"]["status"], Tone> = {
  HEALTHY: "ok",
  DEGRADED: "warn",
  UNHEALTHY: "danger",
  UNKNOWN: "neutral",
  DISABLED: "neutral",
};
const CARRIER_SCOPE_TONE: Record<NonNullable<SipTrunk["carrier"]>["scope"], Tone> = { SYSTEM: "info", TENANT: "neutral" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * SIP trunk detail (Phase 12O-2u). Fetches the single trunk fresh by id via
 * GET /v1/telecom/sip-trunks/{id} (control-plane config only; honest UNKNOWN
 * health — no live connectivity; credential shown as a non-secret reference).
 * Read-only; `sip_trunk.read` is re-checked server-side. Mounted keyed by id so
 * each open refetches; a foreign/removed trunk surfaces the API's 404 inline.
 */
export function SipTrunkDetailDrawer({ trunkId, onClose }: { trunkId: string; onClose: () => void }) {
  const fetchTrunk = React.useCallback((s: AbortSignal) => getSipTrunk(trunkId, s), [trunkId]);
  const { data, loading, error } = useResource<SipTrunk>(fetchTrunk);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{data?.name ?? "SIP trunk"}</DialogTitle>
        <DialogDescription className="sr-only">SIP trunk detail</DialogDescription>

        {loading ? (
          <p className="text-[13px] text-muted">Loading SIP trunk…</p>
        ) : error || !data ? (
          <p role="alert" className="text-[13px] text-danger">{error ?? "SIP trunk not found."}</p>
        ) : (
          <dl className="mt-2">
            <Row label="Carrier">
              {data.carrier ? (
                <span>
                  {data.carrier.name}{" "}
                  <Badge tone={CARRIER_SCOPE_TONE[data.carrier.scope]}>{data.carrier.scope}</Badge>
                </span>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Direction">{data.direction}</Row>
            <Row label="Endpoint">{data.host ?? data.sipUri ?? "—"}</Row>
            <Row label="Port"><span className="font-num">{data.port}</span></Row>
            <Row label="Transport">{data.transport}{data.tls ? " · TLS" : ""}</Row>
            <Row label="Auth mode">{data.authMode}</Row>
            <Row label="Allowed IPs">{data.allowedIps.length > 0 ? data.allowedIps.join(", ") : "—"}</Row>
            <Row label="Codecs">{data.codecs.length > 0 ? data.codecs.join(", ") : "—"}</Row>
            <Row label="SRTP">{data.srtp ? "Yes" : "No"}</Row>
            <Row label="DTMF mode">{data.dtmfMode ?? "—"}</Row>
            <Row label="Max CPS"><span className="font-num">{data.maxCps ?? "—"}</span></Row>
            <Row label="Max concurrent calls"><span className="font-num">{data.maxConcurrentCalls ?? "—"}</span></Row>
            <Row label="Status"><Badge tone={STATUS_TONE[data.status]}>{data.status}</Badge></Row>
            <Row label="Health"><Status tone={HEALTH_TONE[data.health.status]} label={data.health.status} /></Row>
            <Row label="Credential">
              {data.credential ? (
                <span>
                  {data.credential.label}{" "}
                  <span className="text-muted">({data.credential.type})</span>
                </span>
              ) : (
                "None"
              )}
            </Row>
            <Row label="Created">{data.createdAt.slice(0, 10)}</Row>
            <Row label="Updated">{data.updatedAt.slice(0, 10)}</Row>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
