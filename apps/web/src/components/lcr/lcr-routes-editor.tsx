"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { LcrPolicy, LcrRoute, LcrRouteInput } from "@/lib/contracts";
import { updateLcrPolicy } from "@/lib/telecom/lcr-actions";
import { listCarriers } from "@/lib/telecom/carriers-actions";

type Currency = LcrRouteInput["currency"];
const CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY"];
const MAX_COST_MICROS = 1_000_000_000_000;
const PREFIX_RE = /^\+?[0-9]{1,15}$/;

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type CarrierOption = { id: string; name: string };

/**
 * An editable route. Numeric fields are held as strings for clean input; the
 * fields this slice does NOT edit (sipTrunk, effective-from/to) are carried through
 * verbatim from the loaded route so a save — which REPLACES the whole route set —
 * never silently drops them. `costMicros` is kept as a raw integer string (no float).
 */
type EditRoute = {
  _key: string;
  carrierId: string;
  prefix: string;
  country: string;
  costMicros: string;
  currency: Currency;
  priority: string;
  weight: string;
  enabled: boolean;
  // preserved, not edited here:
  sipTrunkId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

let keySeq = 0;
const nextKey = () => `lr${keySeq++}`;

function fromRoute(r: LcrRoute): EditRoute {
  return {
    _key: nextKey(),
    carrierId: r.carrierId,
    prefix: r.prefix,
    country: r.country ?? "",
    costMicros: String(r.costMicros),
    currency: r.currency,
    priority: String(r.priority),
    weight: r.weight != null ? String(r.weight) : "",
    enabled: r.enabled,
    sipTrunkId: r.sipTrunkId,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  };
}

function blankRoute(priority: number): EditRoute {
  return {
    _key: nextKey(),
    carrierId: "",
    prefix: "",
    country: "",
    costMicros: "",
    currency: "USD",
    priority: String(priority),
    weight: "",
    enabled: true,
    sipTrunkId: null,
    effectiveFrom: null,
    effectiveTo: null,
  };
}

function parseIntField(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

type RowErr = { index: number; message: string };

/** Build one route's input, carrying preserved fields through, or a row error. */
function buildRoute(e: EditRoute, index: number): LcrRouteInput | { error: RowErr } {
  const err = (message: string) => ({ error: { index, message } });
  if (e.carrierId === "") return err("Carrier is required.");
  if (!PREFIX_RE.test(e.prefix.trim())) return err("Prefix must be up to 15 digits (optional leading +).");

  // costMicros: a required non-negative integer in millionths (no float).
  const cost = parseIntField(e.costMicros);
  if (cost === null) return err("Cost (micros) is required.");
  if (!Number.isInteger(cost) || cost < 0 || cost > MAX_COST_MICROS) {
    return err(`Cost must be a whole number of micros between 0 and ${MAX_COST_MICROS.toLocaleString()}.`);
  }

  const country = e.country.trim().toUpperCase();
  if (country !== "" && !/^[A-Z]{2}$/.test(country)) return err("Country must be a 2-letter ISO code.");

  const prio = parseIntField(e.priority);
  if (prio !== null && (!Number.isInteger(prio) || prio < 0 || prio > 100_000)) return err("Priority must be 0–100000.");
  const weight = parseIntField(e.weight);
  if (weight !== null && (!Number.isInteger(weight) || weight < 1 || weight > 1000)) return err("Weight must be 1–1000.");

  const out: LcrRouteInput = {
    carrierId: e.carrierId,
    prefix: e.prefix.trim(),
    costMicros: cost,
    currency: e.currency,
    enabled: e.enabled,
  };
  if (country) out.country = country;
  if (prio !== null) out.priority = prio;
  if (weight !== null) out.weight = weight;
  // Preserve fields not edited in this slice.
  if (e.sipTrunkId) out.sipTrunkId = e.sipTrunkId;
  if (e.effectiveFrom) out.effectiveFrom = e.effectiveFrom;
  if (e.effectiveTo) out.effectiveTo = e.effectiveTo;
  return out;
}

/**
 * LCR routes editor (Phase 12O-2ak). Edits a policy's route candidates and saves
 * them via PATCH, which REPLACES the whole set — so the editor loads every current
 * route and sends them all back, and `expectedVersion` guards a concurrent change
 * (409). `costMicros` is entered as a RAW INTEGER in millionths of a currency unit
 * (no floating point, per the money rule). Each route needs a carrier (chosen from
 * the tenant's carriers — the LCR API returns ids only, so an unknown current id is
 * shown by id until the list loads), a prefix, a cost and a currency; priority,
 * weight, country and enabled are optional. The fields this slice does not expose —
 * SIP trunk and effective-from/to — are PRESERVED verbatim on existing routes (a
 * chip marks a route that carries them). The server validates carrier accessibility
 * and trunk ownership and re-checks `routing.manage`.
 */
export function LcrRoutesEditor({
  policy,
  onClose,
  onSaved,
}: {
  policy: LcrPolicy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [routes, setRoutes] = React.useState<EditRoute[]>(() => policy.candidates.map(fromRoute));

  // Carrier picker options, loaded once and seeded with the routes' current ids
  // (labelled by id until the real name loads, since the LCR API returns ids only).
  const seeded = React.useMemo<CarrierOption[]>(() => {
    const ids = new Map<string, CarrierOption>();
    for (const c of policy.candidates) ids.set(c.carrierId, { id: c.carrierId, name: c.carrierId });
    return [...ids.values()];
  }, [policy.candidates]);
  const [carriers, setCarriers] = React.useState<CarrierOption[]>(seeded);
  const [carriersError, setCarriersError] = React.useState<string | null>(null);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<RowErr | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    listCarriers({ limit: 100 }, ac.signal)
      .then((page) => {
        if (!active) return;
        const loaded = page.items.map((c) => ({ id: c.id, name: c.name }));
        setCarriers((prev) => {
          const byId = new Map(prev.map((o) => [o.id, o]));
          for (const o of loaded) byId.set(o.id, o); // real name overrides the id-fallback seed
          return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setCarriersError(messageFor(err));
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, []);

  function patchRoute(key: string, patch: Partial<EditRoute>) {
    setRoutes((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function removeRoute(key: string) {
    setRoutes((prev) => prev.filter((r) => r._key !== key));
  }
  function addRoute() {
    const maxPriority = routes.reduce((m, r) => Math.max(m, Number(r.priority) || 0), 0);
    setRoutes((prev) => [...prev, blankRoute(maxPriority + 10)]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRowError(null);

    const inputs: LcrRouteInput[] = [];
    for (let i = 0; i < routes.length; i++) {
      const built = buildRoute(routes[i], i);
      if ("error" in built) {
        setRowError(built.error);
        return;
      }
      inputs.push(built);
    }

    setPending(true);
    try {
      await updateLcrPolicy(policy.id, { routes: inputs, expectedVersion: policy.version });
      onSaved();
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  const hasPreserved = (r: EditRoute) => Boolean(r.sipTrunkId || r.effectiveFrom || r.effectiveTo);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Edit routes — {policy.name}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          Declarative route selection only; nothing is dialled or rated. Cost is entered in micros (millionths
          of a currency unit) — e.g. 12000 = 0.012 per minute. SIP trunk and effective dates are preserved but
          not edited here.
        </DialogDescription>

        {carriersError && (
          <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
            Couldn&apos;t load carriers: {carriersError}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-4">
          {routes.length === 0 ? (
            <p className="rounded-lg bg-canvas px-4 py-6 text-center text-[13px] text-ink-2">
              No route candidates. Add one, or save to leave this policy with no routes.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {routes.map((r, i) => (
                <li key={r._key} className="rounded-lg border border-line bg-canvas p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold text-muted">Route {i + 1}</span>
                    <div className="flex items-center gap-2">
                      {hasPreserved(r) && (
                        <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted" title="This route has a SIP trunk and/or effective dates preserved but not editable here">
                          + advanced preserved
                        </span>
                      )}
                      <button type="button" onClick={() => removeRoute(r._key)} className="text-muted hover:text-danger" aria-label={`Remove route ${i + 1}`}>
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </div>
                  </div>

                  <Field id={`${r._key}-carrier`} label="Carrier">
                    <select
                      id={`${r._key}-carrier`}
                      className={selectClass}
                      value={r.carrierId}
                      onChange={(ev) => patchRoute(r._key, { carrierId: ev.target.value })}
                    >
                      <option value="">Select a carrier…</option>
                      {carriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>

                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <Field id={`${r._key}-prefix`} label="Prefix" hint="e.g. 44, 9198">
                      <Input id={`${r._key}-prefix`} value={r.prefix} maxLength={16} onChange={(ev) => patchRoute(r._key, { prefix: ev.target.value })} className="font-mono" />
                    </Field>
                    <Field id={`${r._key}-cost`} label="Cost (micros)" hint="integer millionths">
                      <Input id={`${r._key}-cost`} inputMode="numeric" value={r.costMicros} onChange={(ev) => patchRoute(r._key, { costMicros: ev.target.value })} className="font-num" />
                    </Field>
                    <Field id={`${r._key}-currency`} label="Currency">
                      <select id={`${r._key}-currency`} className={selectClass} value={r.currency} onChange={(ev) => patchRoute(r._key, { currency: ev.target.value as Currency })}>
                        {CURRENCIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <Field id={`${r._key}-priority`} label="Priority">
                      <Input id={`${r._key}-priority`} inputMode="numeric" value={r.priority} onChange={(ev) => patchRoute(r._key, { priority: ev.target.value })} placeholder="0–100000" />
                    </Field>
                    <Field id={`${r._key}-weight`} label="Weight">
                      <Input id={`${r._key}-weight`} inputMode="numeric" value={r.weight} onChange={(ev) => patchRoute(r._key, { weight: ev.target.value })} placeholder="1–1000" />
                    </Field>
                    <Field id={`${r._key}-country`} label="Country" hint="ISO-2, optional">
                      <Input id={`${r._key}-country`} value={r.country} maxLength={2} onChange={(ev) => patchRoute(r._key, { country: ev.target.value.toUpperCase() })} className="uppercase" />
                    </Field>
                  </div>

                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                    <input type="checkbox" checked={r.enabled} onChange={(ev) => patchRoute(r._key, { enabled: ev.target.checked })} className="accent-[var(--accent)]" />
                    Enabled
                  </label>

                  {rowError?.index === i && (
                    <p role="alert" className="mt-2 text-[12px] text-danger">{rowError.message}</p>
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" onClick={addRoute}>Add route</Button>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save routes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
