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
import { listSipTrunks } from "@/lib/telecom/sip-trunks-actions";

type Currency = LcrRouteInput["currency"];
const CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY"];
const MAX_COST_MICROS = 1_000_000_000_000;
const MICROS_PER_UNIT = 1_000_000;
const PREFIX_RE = /^\+?[0-9]{1,15}$/;

/**
 * An integer count of micros → a decimal amount in currency units, EXACTLY, via
 * string slicing (no floating-point division). e.g. 12000 → "0.012", 1500000 → "1.5".
 */
function microsToDecimal(micros: number): string {
  const s = String(micros).padStart(7, "0"); // ≥1 integer digit + 6 fractional
  const intPart = s.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fracPart = s.slice(-6).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}
const INVALID_COST = "__invalid_cost__";
/**
 * A decimal amount in currency units → integer micros, EXACTLY (no float): parse the
 * whole and up-to-6 fractional digits as integers and combine. "" → null; anything
 * that isn't a plain non-negative decimal with ≤6 fraction digits → INVALID_COST.
 */
function decimalToMicros(v: string): number | null | typeof INVALID_COST {
  const t = v.trim();
  if (t === "") return null;
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(t);
  if (!m) return INVALID_COST;
  const frac = (m[2] ?? "").padEnd(6, "0");
  return Number(m[1]) * MICROS_PER_UNIT + Number(frac);
}

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type Opt = { id: string; name: string };

/** ISO instant → "YYYY-MM-DDTHH:MM" in the viewer's local tz (for a datetime-local input); "" when null/invalid. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** A datetime-local string (local tz) → an ISO-8601 instant; null when blank; NaN-guarded (returns the sentinel for invalid). */
const INVALID_DATE = "__invalid__";
function localInputToIso(v: string): string | null | typeof INVALID_DATE {
  const t = v.trim();
  if (t === "") return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? INVALID_DATE : d.toISOString();
}

/**
 * An editable route. Numeric fields are held as strings for clean input; the SIP
 * trunk is chosen from a picker and the effective-from/to window is entered with
 * datetime-local inputs (local tz), converted to ISO instants on save. `costMicros`
 * is kept as a raw integer string (no float). The whole set is sent on save (replace
 * semantics), so every route carries all of its own fields.
 */
type EditRoute = {
  _key: string;
  carrierId: string;
  prefix: string;
  country: string;
  cost: string; // decimal amount in currency units (e.g. "0.012"); converted to integer micros on save
  currency: Currency;
  priority: string;
  weight: string;
  enabled: boolean;
  sipTrunkId: string; // "" = none
  effectiveFrom: string; // "" or "YYYY-MM-DDTHH:MM" (local)
  effectiveTo: string;
};

let keySeq = 0;
const nextKey = () => `lr${keySeq++}`;

function fromRoute(r: LcrRoute): EditRoute {
  return {
    _key: nextKey(),
    carrierId: r.carrierId,
    prefix: r.prefix,
    country: r.country ?? "",
    cost: microsToDecimal(r.costMicros),
    currency: r.currency,
    priority: String(r.priority),
    weight: r.weight != null ? String(r.weight) : "",
    enabled: r.enabled,
    sipTrunkId: r.sipTrunkId ?? "",
    effectiveFrom: isoToLocalInput(r.effectiveFrom),
    effectiveTo: isoToLocalInput(r.effectiveTo),
  };
}

function blankRoute(priority: number): EditRoute {
  return {
    _key: nextKey(),
    carrierId: "",
    prefix: "",
    country: "",
    cost: "",
    currency: "USD",
    priority: String(priority),
    weight: "",
    enabled: true,
    sipTrunkId: "",
    effectiveFrom: "",
    effectiveTo: "",
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

  // Cost: a required decimal amount in currency units, converted to integer micros
  // with exact string math (no float). ≤6 decimal places; bounded.
  const cost = decimalToMicros(e.cost);
  if (cost === null) return err("Cost is required.");
  if (cost === INVALID_COST) return err("Cost must be a number with at most 6 decimal places.");
  if (cost > MAX_COST_MICROS) {
    return err(`Cost must be at most ${(MAX_COST_MICROS / MICROS_PER_UNIT).toLocaleString()} per minute.`);
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
  if (e.sipTrunkId) out.sipTrunkId = e.sipTrunkId;

  // Effective window — each side optional; when both are set, from must precede to.
  const from = localInputToIso(e.effectiveFrom);
  if (from === INVALID_DATE) return err("Effective-from is not a valid date/time.");
  const to = localInputToIso(e.effectiveTo);
  if (to === INVALID_DATE) return err("Effective-to is not a valid date/time.");
  if (from && to && new Date(from) >= new Date(to)) return err("Effective-from must be before effective-to.");
  if (from) out.effectiveFrom = from;
  if (to) out.effectiveTo = to;
  return out;
}

/**
 * LCR routes editor (Phase 12O-2ak; SIP trunk + effective dates made editable in
 * 12O-2aq). Edits a policy's route candidates and saves them via PATCH, which
 * REPLACES the whole set — so the editor loads every current route and sends them
 * all back, and `expectedVersion` guards a concurrent change (409). Cost is entered
 * as a DECIMAL amount per currency unit (e.g. 0.012) and converted to the integer
 * `costMicros` with EXACT string math (≤6 decimal places, no floating point, per the
 * money rule); a live hint shows the resulting micro count. Each route needs a
 * carrier (chosen from the tenant's carriers), a
 * prefix, a cost and a currency; an optional SIP trunk (its own picker), priority,
 * weight, country, an effective-from/to window (datetime-local, entered in the
 * viewer's tz and converted to ISO instants), and enabled are optional. Both pickers
 * seed from the routes' current ids (the LCR API returns ids only) and show by id
 * until the lists load. The server validates carrier accessibility and trunk
 * ownership and re-checks `routing.manage`.
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

  // Carrier + SIP-trunk picker options, loaded once and seeded with the routes'
  // current ids (labelled by id until the real name loads, since the LCR API
  // returns ids only). Each list's load failure surfaces inline but doesn't block.
  const seededCarriers = React.useMemo<Opt[]>(() => {
    const ids = new Map<string, Opt>();
    for (const c of policy.candidates) ids.set(c.carrierId, { id: c.carrierId, name: c.carrierId });
    return [...ids.values()];
  }, [policy.candidates]);
  const seededTrunks = React.useMemo<Opt[]>(() => {
    const ids = new Map<string, Opt>();
    for (const c of policy.candidates) if (c.sipTrunkId) ids.set(c.sipTrunkId, { id: c.sipTrunkId, name: c.sipTrunkId });
    return [...ids.values()];
  }, [policy.candidates]);
  const [carriers, setCarriers] = React.useState<Opt[]>(seededCarriers);
  const [carriersError, setCarriersError] = React.useState<string | null>(null);
  const [trunks, setTrunks] = React.useState<Opt[]>(seededTrunks);
  const [trunksError, setTrunksError] = React.useState<string | null>(null);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<RowErr | null>(null);

  function mergeById(prev: Opt[], loaded: Opt[]): Opt[] {
    const byId = new Map(prev.map((o) => [o.id, o]));
    for (const o of loaded) byId.set(o.id, o); // real name overrides the id-fallback seed
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    listCarriers({ limit: 100 }, ac.signal)
      .then((page) => {
        if (!active) return;
        setCarriers((prev) => mergeById(prev, page.items.map((c) => ({ id: c.id, name: c.name }))));
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setCarriersError(messageFor(err));
      });
    listSipTrunks({ limit: 100 }, ac.signal)
      .then((page) => {
        if (!active) return;
        setTrunks((prev) => mergeById(prev, page.items.map((t) => ({ id: t.id, name: t.name }))));
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setTrunksError(messageFor(err));
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

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Edit routes — {policy.name}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          Declarative route selection only; nothing is dialled or rated. Cost is a per-minute amount in the
          chosen currency (e.g. 0.012) — stored exactly, to the millionth. Effective dates are in your local time.
        </DialogDescription>

        {carriersError && (
          <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
            Couldn&apos;t load carriers: {carriersError}
          </p>
        )}
        {trunksError && (
          <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
            Couldn&apos;t load SIP trunks: {trunksError}
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
                    <button type="button" onClick={() => removeRoute(r._key)} className="text-muted hover:text-danger" aria-label={`Remove route ${i + 1}`}>
                      <Trash2 aria-hidden className="size-4" />
                    </button>
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
                    <Field
                      id={`${r._key}-cost`}
                      label="Cost / min"
                      hint={(() => {
                        const m = decimalToMicros(r.cost);
                        return typeof m === "number" ? `= ${m.toLocaleString()} micros` : "per currency unit";
                      })()}
                    >
                      <Input id={`${r._key}-cost`} inputMode="decimal" value={r.cost} onChange={(ev) => patchRoute(r._key, { cost: ev.target.value })} className="font-num" placeholder="0.012" />
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

                  <Field id={`${r._key}-trunk`} label="SIP trunk" hint="Optional." className="mt-2">
                    <select id={`${r._key}-trunk`} className={selectClass} value={r.sipTrunkId} onChange={(ev) => patchRoute(r._key, { sipTrunkId: ev.target.value })}>
                      <option value="">— none</option>
                      {trunks.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </Field>

                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Field id={`${r._key}-eff-from`} label="Effective from" hint="Optional.">
                      <Input id={`${r._key}-eff-from`} type="datetime-local" value={r.effectiveFrom} onChange={(ev) => patchRoute(r._key, { effectiveFrom: ev.target.value })} />
                    </Field>
                    <Field id={`${r._key}-eff-to`} label="Effective to" hint="Optional.">
                      <Input id={`${r._key}-eff-to`} type="datetime-local" value={r.effectiveTo} onChange={(ev) => patchRoute(r._key, { effectiveTo: ev.target.value })} />
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
