"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { Did, CreateDid, UpdateDid } from "@/lib/contracts";
import { createDid, updateDid } from "@/lib/telecom/dids-actions";
import { listCarriers } from "@/lib/telecom/carriers-actions";
import { listSipTrunks } from "@/lib/telecom/sip-trunks-actions";
import { listRoutingProfiles } from "@/lib/telecom/routing-actions";
import { listRegions } from "@/lib/telecom/telecom-actions";

type Status = NonNullable<CreateDid["status"]>;
type Opt = { id: string; name: string };

const STATUS_OPTIONS: readonly Status[] = ["AVAILABLE", "RESERVED", "ASSIGNED", "ACTIVE", "SUSPENDED", "PORTING", "RELEASED"];

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type Mode = { mode: "create" } | { mode: "edit"; did: Did };

/**
 * Load a relationship picker's options (first page), merging a seeded current id.
 * The DID API returns reference ids only (no names), so in edit mode the current
 * selection is seeded labelled by its id and the real name overrides once the list
 * loads; if a picker's list can't load (e.g. the session lacks that read
 * permission) the error surfaces and only "None" / the current value remain.
 */
function useOptions(loader: (signal: AbortSignal) => Promise<Opt[]>, seedId: string | null) {
  const [options, setOptions] = React.useState<Opt[]>(seedId ? [{ id: seedId, name: seedId }] : []);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    loader(ac.signal)
      .then((loaded) => {
        if (!active) return;
        setOptions((prev) => {
          const byId = new Map(prev.map((o) => [o.id, o]));
          for (const o of loaded) byId.set(o.id, o); // real name overrides the id-fallback seed
          return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(messageFor(err));
        setLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
    // Loaders are stable module fns and seedId is fixed per mount (the form is keyed).
  }, []);
  return { options, loading, error };
}

const loadCarriers = (s: AbortSignal) => listCarriers({ limit: 100 }, s).then((p) => p.items.map((c) => ({ id: c.id, name: c.name })));
const loadTrunks = (s: AbortSignal) => listSipTrunks({ limit: 100 }, s).then((p) => p.items.map((t) => ({ id: t.id, name: t.name })));
const loadRouting = (s: AbortSignal) => listRoutingProfiles({ limit: 100 }, s).then((p) => p.items.map((r) => ({ id: r.id, name: r.name })));
// Regions are platform-scoped and returned as a plain array (no pagination).
const loadRegions = (s: AbortSignal) => listRegions(s).then((rs) => rs.map((r) => ({ id: r.id, name: `${r.name} (${r.code})` })));

function PickerField({
  id,
  label,
  value,
  onChange,
  state,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  state: { options: Opt[]; loading: boolean; error: string | null };
}) {
  return (
    <Field id={id} label={label} error={state.error ?? undefined} hint={state.error ? undefined : "Optional."}>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{state.loading && state.options.length === 0 ? "Loading…" : "— None —"}</option>
        {state.options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Create / edit a DID (number) (Phase 12O-2ag; region added in 12O-2ao). Create
 * takes a raw phone number (normalized to canonical E.164 server-side; `country` is
 * derived there, never sent) plus an optional administrative status and optional
 * carrier / SIP trunk / routing-profile / region references. Edit covers status and
 * the same references (clearing a picker detaches it via an explicit null); the
 * number itself is immutable and shown read-only. All writes go through a
 * single `did.manage` permission; the server re-checks it, re-normalizes the
 * number, and re-validates every relationship (including the carrier/trunk
 * consistency rule) on each call. NOTE: the backend does not yet enforce
 * status-transition rules, so status is a free administrative field here.
 */
export function NumberForm(props: Mode & { onClose: () => void; onSaved: () => void }) {
  const { onClose, onSaved } = props;
  const existing = props.mode === "edit" ? props.did : null;

  const [number, setNumber] = React.useState("");
  const [status, setStatus] = React.useState<"" | Status>(existing?.status ?? "");
  const [carrierId, setCarrierId] = React.useState(existing?.carrierId ?? "");
  const [sipTrunkId, setSipTrunkId] = React.useState(existing?.sipTrunkId ?? "");
  const [routingProfileId, setRoutingProfileId] = React.useState(existing?.routingProfileId ?? "");
  const [regionId, setRegionId] = React.useState(existing?.regionId ?? "");

  const carriers = useOptions(loadCarriers, existing?.carrierId ?? null);
  const trunks = useOptions(loadTrunks, existing?.sipTrunkId ?? null);
  const routing = useOptions(loadRouting, existing?.routingProfileId ?? null);
  const regions = useOptions(loadRegions, existing?.regionId ?? null);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ field: string; message: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);

    if (!existing) {
      const trimmed = number.trim();
      if (trimmed.length < 3 || trimmed.length > 32) {
        setFieldError({ field: "number", message: "Enter a phone number (3–32 characters)." });
        return;
      }
    }

    setPending(true);
    try {
      if (existing) {
        // Edit: number immutable. A cleared picker sends null to detach.
        const body: UpdateDid = {
          carrierId: carrierId || null,
          sipTrunkId: sipTrunkId || null,
          routingProfileId: routingProfileId || null,
          regionId: regionId || null,
        };
        if (status) body.status = status;
        await updateDid(existing.id, body);
      } else {
        const body: CreateDid = { number: number.trim() };
        if (status) body.status = status;
        if (carrierId) body.carrierId = carrierId;
        if (sipTrunkId) body.sipTrunkId = sipTrunkId;
        if (routingProfileId) body.routingProfileId = routingProfileId;
        if (regionId) body.regionId = regionId;
        await createDid(body);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  const numberError = fieldError?.field === "number" ? fieldError.message : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogTitle>{existing ? "Edit number" : "New number"}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {existing
            ? "Update this number's status and routing references."
            : "Add a number to your inventory. It is normalized to canonical E.164 and its country derived automatically."}{" "}
          Control-plane configuration only.
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          {existing ? (
            <Field id="number-e164" label="Number" hint="The number is immutable.">
              <Input id="number-e164" value={existing.e164} readOnly disabled className="font-mono" />
            </Field>
          ) : (
            <Field id="number-e164" label="Number" error={numberError} hint={numberError ? undefined : "E.164 or local format; normalized server-side."}>
              <Input
                id="number-e164"
                autoFocus
                value={number}
                maxLength={32}
                onChange={(e) => setNumber(e.target.value)}
                aria-invalid={numberError ? true : undefined}
                placeholder="+14155550100"
                className="font-mono"
              />
            </Field>
          )}

          <Field id="number-status" label="Status" hint={existing ? undefined : "Defaults to Available."}>
            <select id="number-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as "" | Status)}>
              <option value="">—</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>

          <PickerField id="number-carrier" label="Carrier" value={carrierId} onChange={setCarrierId} state={carriers} />
          <PickerField id="number-trunk" label="SIP trunk" value={sipTrunkId} onChange={setSipTrunkId} state={trunks} />
          <PickerField id="number-routing" label="Routing profile" value={routingProfileId} onChange={setRoutingProfileId} state={routing} />
          <PickerField id="number-region" label="Region" value={regionId} onChange={setRegionId} state={regions} />

          {error && (
            <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : existing ? "Save changes" : "Create number"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
