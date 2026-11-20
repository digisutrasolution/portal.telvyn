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

const TYPE_OPTIONS: readonly CarrierType[] = ["ORIGINATION", "TERMINATION", "BIDIRECTIONAL"];
const STATUS_OPTIONS: readonly Carrier["status"][] = ["ACTIVE", "SUSPENDED", "DISABLED"];
const CODEC_OPTIONS: readonly Codec[] = ["PCMU", "PCMA", "G722", "G729", "OPUS", "AMR", "AMR_WB"];

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
 * Create / edit a carrier (Phase 12O-2ae — the first write slice). Covers the
 * declarative fields (name, type, country, status, priority, codecs, capacity).
 * Scope/ownership are server-derived and never sent. `regionId` and credential
 * management are deferred to a later slice (both optional on the API) — editing
 * a carrier here never touches them. In edit mode, clearing an optional numeric
 * field leaves it unchanged (the API has no "unset" for these). The server
 * re-validates and re-checks `carrier.create` / `carrier.update` on every call.
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
