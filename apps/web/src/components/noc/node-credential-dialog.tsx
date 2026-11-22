"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Node } from "@/lib/contracts";
import { attachNodeCredential, detachNodeCredential } from "@/lib/telecom/telecom-actions";
import { messageFor } from "@/components/auth/auth-message";

/**
 * Node-agent credential management (Phase 12O-2bd). Shows the node's current
 * NODE_AGENT mTLS identity (its certificate fingerprint — non-secret) and lets a
 * platform operator attach, rotate, or detach it. Only the node's PUBLIC client
 * certificate is submitted; the private key stays on the node. `telecom.manage` is
 * gated here for UX; the API re-checks. On success the list is reloaded.
 */
export function NodeCredentialDialog({ node, onClose, onSaved }: { node: Node; onClose: () => void; onSaved: () => void }) {
  const existing = node.credential;
  const [certificate, setCertificate] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState<"attach" | "detach" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function attach() {
    if (!certificate.trim()) {
      setError("Paste the node's client certificate (PEM).");
      return;
    }
    setPending("attach");
    setError(null);
    try {
      await attachNodeCredential(node.id, { certificate, label: label.trim() || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(null);
    }
  }

  async function detach() {
    setPending("detach");
    setError(null);
    try {
      await detachNodeCredential(node.id);
      onSaved();
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogTitle>Node-agent credential — {node.name}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          The node authenticates its heartbeat with an mTLS client certificate. Paste the node&apos;s
          public certificate; its private key never leaves the node.
        </DialogDescription>

        <div className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px]">
          {existing ? (
            <>
              <span className="text-ink-2">Current identity</span>
              <div className="mt-1 text-ink">{existing.label}</div>
              <div className="font-mono mt-0.5 break-all text-[11px] text-muted" aria-label="Certificate fingerprint">{existing.hint ?? "—"}</div>
            </>
          ) : (
            <span className="text-ink-2">No credential attached — this node cannot be authenticated yet.</span>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Field id="node-cred-cert" label={existing ? "Replacement certificate (PEM)" : "Certificate (PEM)"} hint="Public X.509 client certificate — never the private key.">
            <textarea
              id="node-cred-cert"
              value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-[11px] text-ink outline-none"
              placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"}
            />
          </Field>
          <Field id="node-cred-label" label="Label" hint="Optional; a human name for this identity.">
            <Input id="node-cred-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. edge-sip-01 agent" />
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <span>
            {existing && (
              <Button type="button" variant="danger" size="sm" onClick={detach} disabled={pending !== null}>
                {pending === "detach" ? "Detaching…" : "Detach"}
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending !== null}>Cancel</Button>
            <Button type="button" variant="primary" size="sm" onClick={attach} disabled={pending !== null}>
              {pending === "attach" ? "Saving…" : existing ? "Rotate" : "Attach"}
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
