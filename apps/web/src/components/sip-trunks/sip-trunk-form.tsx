"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { SipTrunk, CreateSipTrunk, UpdateSipTrunk } from "@/lib/contracts";
import { createSipTrunk, updateSipTrunk } from "@/lib/telecom/sip-trunks-actions";
import { listCarriers } from "@/lib/telecom/carriers-actions";

type Direction = NonNullable<CreateSipTrunk["direction"]>;
type Transport = NonNullable<CreateSipTrunk["transport"]>;
type AuthMode = NonNullable<CreateSipTrunk["authMode"]>;
type Status = NonNullable<CreateSipTrunk["status"]>;
type Dtmf = NonNullable<CreateSipTrunk["dtmfMode"]>;
type Codec = NonNullable<CreateSipTrunk["codecs"]>[number];
type CarrierOption = { id: string; name: string };

const DIRECTION_OPTIONS: readonly Direction[] = ["INBOUND", "OUTBOUND", "BIDIRECTIONAL"];
const TRANSPORT_OPTIONS: readonly Transport[] = ["UDP", "TCP", "TLS"];
const AUTH_OPTIONS: readonly AuthMode[] = ["IP", "CREDENTIALS"];
const STATUS_OPTIONS: readonly Status[] = ["ACTIVE", "SUSPENDED", "DISABLED"];
const DTMF_OPTIONS: readonly Dtmf[] = ["rfc2833", "info", "inband"];
const CODEC_OPTIONS: readonly Codec[] = ["PCMU", "PCMA", "G722", "G729", "OPUS", "AMR", "AMR_WB"];

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type Mode = { mode: "create" } | { mode: "edit"; trunk: SipTrunk };

/** A numeric string → integer; null when blank; NaN when non-integer (caller validates). */
function parseIntField(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/** Split a newline/comma-separated list into trimmed non-empty entries (server validates IP/CIDR format). */
function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Create / edit a SIP trunk (Phase 12O-2af; inline credential added in 12O-2an).
 * Covers the declarative control-plane fields (carrier, endpoint, transport, auth
 * mode, codecs, capacity) and an optional INLINE credential — a label/hint plus a
 * write-only secret that goes straight to the vault (the trunk only ever carries a
 * non-secret reference back; the credential type is forced SIP_PASSWORD server-side,
 * so there is no type field). The secret is never pre-filled and the existing secret
 * is never readable; on edit the current credential is shown as a reference and a
 * "Replace credential" toggle reveals the inline fields (omitted → the credential is
 * left unchanged). Attaching an *existing* credential by id is NOT offered (no
 * credentials-list endpoint), and the API has no way to DETACH one, so neither does
 * this form. Ownership is server-derived and never sent. Endpoint values are validated
 * server-side as attacker-controlled input (host / sipUri / allowed IPs). The server
 * re-checks `sip_trunk.create` / `sip_trunk.update`, re-validates every field, and
 * vaults the secret (never returned) on each call.
 */
export function SipTrunkForm(props: Mode & { onClose: () => void; onSaved: () => void }) {
  const { onClose, onSaved } = props;
  const existing = props.mode === "edit" ? props.trunk : null;

  const [name, setName] = React.useState(existing?.name ?? "");
  const [carrierId, setCarrierId] = React.useState(existing?.carrierId ?? "");
  const [direction, setDirection] = React.useState<"" | Direction>(existing?.direction ?? "");
  const [host, setHost] = React.useState(existing?.host ?? "");
  const [sipUri, setSipUri] = React.useState(existing?.sipUri ?? "");
  const [port, setPort] = React.useState(existing?.port != null ? String(existing.port) : "");
  const [transport, setTransport] = React.useState<"" | Transport>(existing?.transport ?? "");
  const [tls, setTls] = React.useState(existing?.tls ?? false);
  const [authMode, setAuthMode] = React.useState<"" | AuthMode>(existing?.authMode ?? "");
  const [allowedIps, setAllowedIps] = React.useState((existing?.allowedIps ?? []).join("\n"));
  const [codecs, setCodecs] = React.useState<Codec[]>(existing?.codecs ?? []);
  const [srtp, setSrtp] = React.useState(existing?.srtp ?? false);
  const [dtmfMode, setDtmfMode] = React.useState<"" | Dtmf>((existing?.dtmfMode as Dtmf | null | undefined) ?? "");
  const [maxCps, setMaxCps] = React.useState(existing?.maxCps != null ? String(existing.maxCps) : "");
  const [maxConcurrent, setMaxConcurrent] = React.useState(
    existing?.maxConcurrentCalls != null ? String(existing.maxConcurrentCalls) : "",
  );
  const [status, setStatus] = React.useState<"" | Status>(existing?.status ?? "");

  // Inline credential (Phase 12O-2an). Off by default; the secret is write-only and
  // never pre-filled. On edit, engaging this REPLACES the trunk's credential. The SIP
  // credential type is forced to SIP_PASSWORD server-side, so there is no type field.
  const [showCred, setShowCred] = React.useState(false);
  const [credLabel, setCredLabel] = React.useState("");
  const [credHint, setCredHint] = React.useState("");
  const [credSecret, setCredSecret] = React.useState("");

  // Carrier picker — carrierId is a required FK, re-validated for scope access server-side.
  // Seed with the trunk's current carrier (edit) so it always shows even if outside the first page.
  const seededCarrier = existing?.carrier ? [{ id: existing.carrier.id, name: existing.carrier.name }] : [];
  const [carriers, setCarriers] = React.useState<CarrierOption[]>(seededCarrier);
  const [carriersLoading, setCarriersLoading] = React.useState(true);
  const [carriersError, setCarriersError] = React.useState<string | null>(null);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ field: string; message: string } | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setCarriersLoading(true);
    setCarriersError(null);
    // First page is sufficient for a picker; the server re-validates the chosen id's scope access.
    listCarriers({ limit: 100 }, ac.signal)
      .then((page) => {
        if (!active) return;
        const loaded = page.items.map((c) => ({ id: c.id, name: c.name }));
        // Merge the seeded current carrier (edit) without duplicating.
        setCarriers((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]));
          for (const c of loaded) byId.set(c.id, c);
          return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
        setCarriersLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setCarriersError(messageFor(err));
        setCarriersLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, []);

  function toggleCodec(c: Codec) {
    setCodecs((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  /** Build the request body from the declarative fields, or a field error. */
  function buildBody(): CreateSipTrunk | { error: { field: string; message: string } } {
    const trimmedName = name.trim();
    if (trimmedName === "") return { error: { field: "name", message: "Name is required." } };
    if (carrierId === "") return { error: { field: "carrierId", message: "Select a carrier." } };

    const portN = parseIntField(port);
    if (portN !== null && (!Number.isInteger(portN) || portN < 1 || portN > 65535)) {
      return { error: { field: "port", message: "Enter a port between 1 and 65535." } };
    }

    const nums: Array<[string, string, number]> = [
      ["maxCps", maxCps, 1_000_000],
      ["maxConcurrentCalls", maxConcurrent, 10_000_000],
    ];
    const parsed: Record<string, number> = {};
    for (const [key, raw, max] of nums) {
      const n = parseIntField(raw);
      if (n === null) continue;
      if (!Number.isInteger(n) || n < 0 || n > max) {
        return { error: { field: key, message: `Enter a whole number between 0 and ${max.toLocaleString()}.` } };
      }
      parsed[key] = n;
    }

    const ips = parseList(allowedIps);
    if (ips.length > 64) {
      return { error: { field: "allowedIps", message: "At most 64 entries." } };
    }

    const body: CreateSipTrunk = { name: trimmedName, carrierId };
    if (direction) body.direction = direction;
    if (host.trim()) body.host = host.trim();
    if (sipUri.trim()) body.sipUri = sipUri.trim();
    if (portN !== null) body.port = portN;
    if (transport) body.transport = transport;
    body.tls = tls;
    if (authMode) body.authMode = authMode;
    body.allowedIps = ips;
    body.codecs = codecs;
    body.srtp = srtp;
    if (dtmfMode) body.dtmfMode = dtmfMode;
    if (parsed.maxCps !== undefined) body.maxCps = parsed.maxCps;
    if (parsed.maxConcurrentCalls !== undefined) body.maxConcurrentCalls = parsed.maxConcurrentCalls;
    if (status) body.status = status;

    // Inline credential — all-or-nothing when engaged (type is forced SIP_PASSWORD
    // server-side, so only label + secret here). Omitted when not, so an edit that
    // doesn't touch it leaves the trunk's credential unchanged.
    if (showCred) {
      const label = credLabel.trim();
      if (label === "") return { error: { field: "credLabel", message: "A credential label is required." } };
      if (credSecret === "") return { error: { field: "credSecret", message: "The secret is required." } };
      const credential: NonNullable<CreateSipTrunk["credential"]> = { label, secret: credSecret };
      const hint = credHint.trim();
      if (hint) credential.hint = hint;
      body.credential = credential;
    }
    return body;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const built = buildBody();
    if ("error" in built) {
      setFieldError(built.error);
      return;
    }
    setPending(true);
    try {
      if (existing) {
        await updateSipTrunk(existing.id, built as UpdateSipTrunk);
      } else {
        await createSipTrunk(built);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  const fe = (field: string) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogTitle>{existing ? "Edit SIP trunk" : "New SIP trunk"}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {existing ? "Update this trunk's configuration." : "Add a SIP trunk to your workspace."} Control-plane
          configuration only — no live connectivity is established. Credentials are managed separately.
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <Field id="trunk-name" label="Name" error={fe("name")}>
            <Input
              id="trunk-name"
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fe("name") ? true : undefined}
              placeholder="Acme outbound"
            />
          </Field>

          <Field
            id="trunk-carrier"
            label="Carrier"
            error={fe("carrierId") ?? carriersError ?? undefined}
            hint={fe("carrierId") || carriersError ? undefined : "Upstream carrier this trunk connects to."}
          >
            <select
              id="trunk-carrier"
              className={selectClass}
              value={carrierId}
              disabled={carriersLoading && carriers.length === 0}
              onChange={(e) => setCarrierId(e.target.value)}
              aria-invalid={fe("carrierId") ? true : undefined}
            >
              <option value="">{carriersLoading && carriers.length === 0 ? "Loading carriers…" : "Select a carrier…"}</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="trunk-direction" label="Direction">
              <select id="trunk-direction" className={selectClass} value={direction} onChange={(e) => setDirection(e.target.value as "" | Direction)}>
                <option value="">—</option>
                {DIRECTION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field id="trunk-status" label="Status" hint={existing ? undefined : "Defaults to Active."}>
              <select id="trunk-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as "" | Status)}>
                <option value="">—</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field id="trunk-host" label="Host" error={fe("host")} hint={fe("host") ? undefined : "Hostname or IP (optional)."}>
            <Input id="trunk-host" value={host} maxLength={253} onChange={(e) => setHost(e.target.value)} placeholder="sip.acme.example" />
          </Field>

          <Field id="trunk-sipuri" label="SIP URI" hint="sip: or sips: URI (optional).">
            <Input id="trunk-sipuri" value={sipUri} maxLength={512} onChange={(e) => setSipUri(e.target.value)} placeholder="sip:sbc.acme.example" />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field id="trunk-port" label="Port" error={fe("port")}>
              <Input id="trunk-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={fe("port") ? true : undefined} placeholder="5060" />
            </Field>
            <Field id="trunk-transport" label="Transport">
              <select id="trunk-transport" className={selectClass} value={transport} onChange={(e) => setTransport(e.target.value as "" | Transport)}>
                <option value="">—</option>
                {TRANSPORT_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field id="trunk-authmode" label="Auth mode">
              <select id="trunk-authmode" className={selectClass} value={authMode} onChange={(e) => setAuthMode(e.target.value as "" | AuthMode)}>
                <option value="">—</option>
                {AUTH_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} className="accent-[var(--accent)]" />
              TLS
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" checked={srtp} onChange={(e) => setSrtp(e.target.checked)} className="accent-[var(--accent)]" />
              SRTP
            </label>
          </div>

          <Field
            id="trunk-allowedips"
            label="Allowed IPs"
            error={fe("allowedIps")}
            hint={fe("allowedIps") ? undefined : "One IPv4/IPv6 address or CIDR per line (for IP auth)."}
          >
            <textarea
              id="trunk-allowedips"
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
              aria-invalid={fe("allowedIps") ? true : undefined}
              rows={2}
              className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-[12px] text-ink outline-none"
              placeholder={"203.0.113.10\n198.51.100.0/24"}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="trunk-maxcps" label="Max CPS" error={fe("maxCps")}>
              <Input id="trunk-maxcps" inputMode="numeric" value={maxCps} onChange={(e) => setMaxCps(e.target.value)} aria-invalid={fe("maxCps") ? true : undefined} />
            </Field>
            <Field id="trunk-maxcc" label="Max calls" error={fe("maxConcurrentCalls")}>
              <Input id="trunk-maxcc" inputMode="numeric" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} aria-invalid={fe("maxConcurrentCalls") ? true : undefined} />
            </Field>
          </div>

          <Field id="trunk-dtmf" label="DTMF mode">
            <select id="trunk-dtmf" className={selectClass} value={dtmfMode} onChange={(e) => setDtmfMode(e.target.value as "" | Dtmf)}>
              <option value="">—</option>
              {DTMF_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Field>

          <fieldset>
            <legend className="mb-1.5 block text-[12px] font-medium text-ink-2">Codecs</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {CODEC_OPTIONS.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
                  <input type="checkbox" checked={codecs.includes(c)} onChange={() => toggleCodec(c)} className="accent-[var(--accent)]" />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-line px-3 pb-3 pt-2">
            <legend className="px-1 text-[12px] font-medium text-ink-2">Credential</legend>
            {existing?.credential ? (
              <p className="text-[12px] text-muted">
                Current: <span className="text-ink-2">{existing.credential.label}</span> ({existing.credential.type})
              </p>
            ) : (
              <p className="text-[12px] text-muted">No credential attached.</p>
            )}

            {!showCred ? (
              <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setShowCred(true)}>
                {existing?.credential ? "Replace credential" : "Attach a credential"}
              </Button>
            ) : (
              <div className="mt-2 space-y-3">
                <p className="text-[12px] text-muted">
                  A SIP password credential — the secret is stored in the vault and never shown again.{existing?.credential ? " Saving replaces the current credential." : ""}
                </p>
                <Field id="trunk-cred-label" label="Credential label" error={fe("credLabel")}>
                  <Input id="trunk-cred-label" value={credLabel} maxLength={120} onChange={(e) => setCredLabel(e.target.value)} aria-invalid={fe("credLabel") ? true : undefined} placeholder="Primary SIP password" />
                </Field>
                <Field id="trunk-cred-hint" label="Hint" hint="Optional, non-secret reminder.">
                  <Input id="trunk-cred-hint" value={credHint} maxLength={120} onChange={(e) => setCredHint(e.target.value)} />
                </Field>
                <Field id="trunk-cred-secret" label="Secret" error={fe("credSecret")}>
                  <Input
                    id="trunk-cred-secret"
                    type="password"
                    autoComplete="off"
                    value={credSecret}
                    maxLength={4096}
                    onChange={(e) => setCredSecret(e.target.value)}
                    aria-invalid={fe("credSecret") ? true : undefined}
                    placeholder="Write-only — vaulted immediately"
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCred(false);
                    setCredLabel("");
                    setCredHint("");
                    setCredSecret("");
                  }}
                >
                  Cancel credential
                </Button>
              </div>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : existing ? "Save changes" : "Create trunk"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
