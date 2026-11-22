"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { Carrier, CreateCarrier, UpdateCarrier } from "@/lib/contracts";
import { createCarrier, updateCarrier } from "@/lib/telecom/carriers-actions";

type CarrierType = NonNullable<Carrier["type"]>;
type Codec = Carrier["codecs"][number];
type CredType = NonNullable<CreateCarrier["credential"]>["type"];

const TYPE_OPTIONS: readonly CarrierType[] = ["ORIGINATION", "TERMINATION", "BIDIRECTIONAL"];
const STATUS_OPTIONS: readonly Carrier["status"][] = ["ACTIVE", "SUSPENDED", "DISABLED"];
const CODEC_OPTIONS: readonly Codec[] = ["PCMU", "PCMA", "G722", "G729", "OPUS", "AMR", "AMR_WB"];
const CRED_TYPE_OPTIONS: readonly { value: CredType; label: string }[] = [
  { value: "SIP_PASSWORD", label: "SIP password" },
  { value: "CARRIER_API", label: "Carrier API" },
  { value: "ENGINE_API", label: "Engine API" },
];

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type Mode = { mode: "create" } | { mode: "edit"; carrier: Carrier };

/** A numeric string → integer; null when blank; NaN when non-integer (caller validates). */
function parseIntField(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Create / edit a carrier (Phase 12O-2ae; credential added in 12O-2am). Covers the
 * declarative fields (name, type, country, status, priority, codecs, capacity) and
 * an optional INLINE credential — a label/hint plus a write-only secret that goes
 * straight to the vault (the carrier only ever carries a non-secret reference back).
 * The secret field is write-only: it is never pre-filled and the existing secret is
 * never readable; on edit the current credential is shown as a reference and a
 * "Replace credential" toggle reveals the inline fields (omitted → the credential is
 * left unchanged). Attaching an *existing* credential by id is NOT offered — there is
 * no credentials-list endpoint to pick from — and the API has no way to DETACH a
 * credential, so neither does this form. Scope/ownership are server-derived and never
 * sent; `regionId` remains deferred. In edit mode, clearing an optional numeric field
 * leaves it unchanged. The server re-validates and re-checks `carrier.create` /
 * `carrier.update` on every call; the secret is vaulted and never returned.
 */
export function CarrierForm(props: Mode & { onClose: () => void; onSaved: () => void }) {
  const { onClose, onSaved } = props;
  const existing = props.mode === "edit" ? props.carrier : null;

  const [name, setName] = React.useState(existing?.name ?? "");
  const [type, setType] = React.useState<"" | CarrierType>(existing?.type ?? "");
  const [status, setStatus] = React.useState<"" | Carrier["status"]>(existing?.status ?? "");
  const [country, setCountry] = React.useState(existing?.country ?? "");
  const [priority, setPriority] = React.useState(existing?.priority != null ? String(existing.priority) : "");
  const [maxCps, setMaxCps] = React.useState(existing?.maxCps != null ? String(existing.maxCps) : "");
  const [maxConcurrent, setMaxConcurrent] = React.useState(
    existing?.maxConcurrentCalls != null ? String(existing.maxConcurrentCalls) : "",
  );
  const [codecs, setCodecs] = React.useState<Codec[]>(existing?.codecs ?? []);

  // Inline credential (Phase 12O-2am). Off by default; the secret is write-only and
  // never pre-filled. On edit, engaging this REPLACES the carrier's credential.
  const [showCred, setShowCred] = React.useState(false);
  const [credType, setCredType] = React.useState<"" | CredType>("");
  const [credLabel, setCredLabel] = React.useState("");
  const [credHint, setCredHint] = React.useState("");
  const [credSecret, setCredSecret] = React.useState("");

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ field: string; message: string } | null>(null);

  function toggleCodec(c: Codec) {
    setCodecs((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  /** Build the request body from the declarative fields, or a field error. */
  function buildBody(): CreateCarrier | { error: { field: string; message: string } } {
    const trimmedName = name.trim();
    if (trimmedName === "") return { error: { field: "name", message: "Name is required." } };

    const cc = country.trim().toUpperCase();
    if (cc !== "" && !/^[A-Z]{2}$/.test(cc)) {
      return { error: { field: "country", message: "Use a 2-letter ISO country code (e.g. US)." } };
    }

    const nums: Array<[string, string, number]> = [
      ["priority", priority, 100_000],
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

    const body: CreateCarrier = { name: trimmedName };
    if (type) body.type = type;
    if (status) body.status = status;
    if (cc) body.country = cc;
    if (parsed.priority !== undefined) body.priority = parsed.priority;
    if (parsed.maxCps !== undefined) body.maxCps = parsed.maxCps;
    if (parsed.maxConcurrentCalls !== undefined) body.maxConcurrentCalls = parsed.maxConcurrentCalls;
    body.codecs = codecs;

    // Inline credential — all-or-nothing when engaged. Omitted entirely when not,
    // so an edit that doesn't touch it leaves the carrier's credential unchanged.
    if (showCred) {
      if (!credType) return { error: { field: "credType", message: "Choose a credential type." } };
      const label = credLabel.trim();
      if (label === "") return { error: { field: "credLabel", message: "A credential label is required." } };
      if (credSecret === "") return { error: { field: "credSecret", message: "The secret is required." } };
      const credential: NonNullable<CreateCarrier["credential"]> = { type: credType, label, secret: credSecret };
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
        await updateCarrier(existing.id, built as UpdateCarrier);
      } else {
        await createCarrier(built);
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
        <DialogTitle>{existing ? "Edit carrier" : "New carrier"}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {existing ? "Update this carrier's configuration." : "Add a carrier to your workspace."} Scope is set
          automatically; credentials and region are managed separately.
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <Field id="carrier-name" label="Name" error={fe("name")}>
            <Input
              id="carrier-name"
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fe("name") ? true : undefined}
              placeholder="Acme SIP"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="carrier-type" label="Type">
              <select id="carrier-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value as "" | CarrierType)}>
                <option value="">—</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field id="carrier-status" label="Status" hint={existing ? undefined : "Defaults to Active."}>
              <select id="carrier-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as "" | Carrier["status"])}>
                <option value="">—</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field id="carrier-country" label="Country" error={fe("country")} hint={fe("country") ? undefined : "ISO 2-letter code (optional)."}>
            <Input
              id="carrier-country"
              value={country}
              maxLength={2}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              aria-invalid={fe("country") ? true : undefined}
              placeholder="US"
              className="w-24 uppercase"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field id="carrier-priority" label="Priority" error={fe("priority")}>
              <Input id="carrier-priority" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} aria-invalid={fe("priority") ? true : undefined} />
            </Field>
            <Field id="carrier-maxcps" label="Max CPS" error={fe("maxCps")}>
              <Input id="carrier-maxcps" inputMode="numeric" value={maxCps} onChange={(e) => setMaxCps(e.target.value)} aria-invalid={fe("maxCps") ? true : undefined} />
            </Field>
            <Field id="carrier-maxcc" label="Max calls" error={fe("maxConcurrentCalls")}>
              <Input id="carrier-maxcc" inputMode="numeric" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} aria-invalid={fe("maxConcurrentCalls") ? true : undefined} />
            </Field>
          </div>

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
                  The secret is stored in the vault and never shown again.{existing?.credential ? " Saving replaces the current credential." : ""}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="carrier-cred-type" label="Credential type" error={fe("credType")}>
                    <select id="carrier-cred-type" className={selectClass} value={credType} onChange={(e) => setCredType(e.target.value as "" | CredType)} aria-invalid={fe("credType") ? true : undefined}>
                      <option value="">—</option>
                      {CRED_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field id="carrier-cred-label" label="Credential label" error={fe("credLabel")}>
                    <Input id="carrier-cred-label" value={credLabel} maxLength={120} onChange={(e) => setCredLabel(e.target.value)} aria-invalid={fe("credLabel") ? true : undefined} placeholder="Acme API key" />
                  </Field>
                </div>
                <Field id="carrier-cred-hint" label="Hint" hint="Optional, non-secret reminder (e.g. last 4).">
                  <Input id="carrier-cred-hint" value={credHint} maxLength={120} onChange={(e) => setCredHint(e.target.value)} />
                </Field>
                <Field id="carrier-cred-secret" label="Secret" error={fe("credSecret")}>
                  <Input
                    id="carrier-cred-secret"
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
                    setCredType("");
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
              {pending ? "Saving…" : existing ? "Save changes" : "Create carrier"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
