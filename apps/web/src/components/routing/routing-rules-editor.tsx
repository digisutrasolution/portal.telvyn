"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { RoutingProfile, RoutingRule, RoutingRuleInput } from "@/lib/contracts";
import { updateRoutingProfile } from "@/lib/telecom/routing-actions";

type DestType = RoutingRuleInput["destinationType"];
const DEST_TYPES: readonly DestType[] = ["PHONE_NUMBER", "EXTENSION", "SIP_TRUNK", "VOICEMAIL", "WEBHOOK"];
const DEST_HINT: Record<DestType, string> = {
  PHONE_NUMBER: "E.164, e.g. +14155550100",
  EXTENSION: "1–10 digits",
  SIP_TRUNK: "SIP trunk id (uuid)",
  VOICEMAIL: "identifier (letters, digits, . _ -)",
  WEBHOOK: "https URL to a public host",
};

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

/**
 * An editable rule. Numeric fields are held as strings for clean input; the
 * advanced fields this slice does NOT edit (carrier, typed failover, schedule)
 * are carried through verbatim from the loaded rule so a save — which REPLACES the
 * whole rule set — never silently drops them.
 */
type EditRule = {
  _key: string;
  destinationType: DestType;
  destination: string;
  priority: string;
  weight: string;
  enabled: boolean;
  timeoutSeconds: string;
  retryCount: string;
  // preserved, not edited here:
  carrierId: string | null;
  failoverDestination: string | null;
  failoverDestinationType: RoutingRule["failoverDestinationType"];
  failoverAfterSeconds: number | null;
  schedule: RoutingRule["schedule"];
};

let keySeq = 0;
const nextKey = () => `r${keySeq++}`;

function fromRule(r: RoutingRule): EditRule {
  return {
    _key: nextKey(),
    destinationType: r.destinationType,
    destination: r.destination,
    priority: String(r.priority),
    weight: r.weight != null ? String(r.weight) : "",
    enabled: r.enabled,
    timeoutSeconds: r.timeoutSeconds != null ? String(r.timeoutSeconds) : "",
    retryCount: r.retryCount != null ? String(r.retryCount) : "",
    carrierId: r.carrierId,
    failoverDestination: r.failoverDestination,
    failoverDestinationType: r.failoverDestinationType,
    failoverAfterSeconds: r.failoverAfterSeconds,
    schedule: r.schedule,
  };
}

function blankRule(priority: number): EditRule {
  return {
    _key: nextKey(),
    destinationType: "PHONE_NUMBER",
    destination: "",
    priority: String(priority),
    weight: "",
    enabled: true,
    timeoutSeconds: "",
    retryCount: "",
    carrierId: null,
    failoverDestination: null,
    failoverDestinationType: null,
    failoverAfterSeconds: null,
    schedule: null,
  };
}

/** A numeric string → integer; null when blank; NaN when non-integer. */
function parseIntField(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

type FieldErr = { index: number; message: string };

/** Build one rule's input, carrying preserved advanced fields through, or a row error. */
function buildRule(e: EditRule, index: number): RoutingRuleInput | { error: FieldErr } {
  if (e.destination.trim() === "") return { error: { index, message: "Destination is required." } };

  const nums: Array<[string, string, number, number]> = [
    ["priority", e.priority, 0, 100_000],
    ["weight", e.weight, 1, 1000],
    ["timeoutSeconds", e.timeoutSeconds, 1, 600],
    ["retryCount", e.retryCount, 0, 10],
  ];
  const parsed: Record<string, number> = {};
  for (const [key, raw, min, max] of nums) {
    const n = parseIntField(raw);
    if (n === null) continue;
    if (!Number.isInteger(n) || n < min || n > max) {
      return { error: { index, message: `${key} must be a whole number between ${min} and ${max}.` } };
    }
    parsed[key] = n;
  }

  const out: RoutingRuleInput = { destinationType: e.destinationType, destination: e.destination.trim(), enabled: e.enabled };
  if (parsed.priority !== undefined) out.priority = parsed.priority;
  if (parsed.weight !== undefined) out.weight = parsed.weight;
  if (parsed.timeoutSeconds !== undefined) out.timeoutSeconds = parsed.timeoutSeconds;
  if (parsed.retryCount !== undefined) out.retryCount = parsed.retryCount;
  // Preserve advanced fields not edited in this slice.
  if (e.carrierId) out.carrierId = e.carrierId;
  if (e.failoverDestination) out.failoverDestination = e.failoverDestination;
  if (e.failoverDestinationType) out.failoverDestinationType = e.failoverDestinationType;
  if (e.failoverAfterSeconds != null) out.failoverAfterSeconds = e.failoverAfterSeconds;
  if (e.schedule) out.schedule = e.schedule as RoutingRuleInput["schedule"];
  return out;
}

/**
 * Routing rules editor (Phase 12O-2ai). Edits a profile's ordered rule set and
 * saves it via PATCH, which REPLACES the whole set — so the editor loads every
 * current rule and sends them all back, and `expectedVersion` guards against a
 * concurrent change (409). This slice edits the core rule fields (destination
 * type + value, priority/order, enabled, weight, timeout, retries); the advanced
 * per-rule options — carrier tag, typed failover, time-of-day schedule — are NOT
 * editable here but are PRESERVED untouched on existing rules (a chip marks a rule
 * that carries them) and remain fully manageable via the API. Destination values
 * are validated per type server-side; `routing.manage` is re-checked there.
 */
export function RoutingRulesEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: RoutingProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = React.useMemo(
    () => [...profile.rules].sort((a, b) => a.priority - b.priority).map(fromRule),
    [profile.rules],
  );
  const [rules, setRules] = React.useState<EditRule[]>(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<FieldErr | null>(null);

  function patchRule(key: string, patch: Partial<EditRule>) {
    setRules((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function removeRule(key: string) {
    setRules((prev) => prev.filter((r) => r._key !== key));
  }
  function addRule() {
    const maxPriority = rules.reduce((m, r) => Math.max(m, Number(r.priority) || 0), 0);
    setRules((prev) => [...prev, blankRule(maxPriority + 10)]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRowError(null);

    const inputs: RoutingRuleInput[] = [];
    for (let i = 0; i < rules.length; i++) {
      const built = buildRule(rules[i], i);
      if ("error" in built) {
        setRowError(built.error);
        return;
      }
      inputs.push(built);
    }

    setPending(true);
    try {
      // Replace the whole rule set; expectedVersion guards a concurrent change.
      await updateRoutingProfile(profile.id, { rules: inputs, expectedVersion: profile.version });
      onSaved();
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  const hasPreserved = (r: EditRule) => Boolean(r.failoverDestination || r.schedule || r.carrierId);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Edit rules — {profile.name}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          Declarative configuration only; nothing is dialled. Rules are tried in priority order (ascending).
          Carrier tag, typed failover and schedule are preserved but not edited here.
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4">
          {rules.length === 0 ? (
            <p className="rounded-lg bg-canvas px-4 py-6 text-center text-[13px] text-ink-2">
              No rules. Add one, or save to leave this profile with no rules.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {rules.map((r, i) => (
                <li key={r._key} className="rounded-lg border border-line bg-canvas p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold text-muted">Rule {i + 1}</span>
                    <div className="flex items-center gap-2">
                      {hasPreserved(r) && (
                        <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted" title="This rule has advanced options (failover / schedule / carrier) preserved but not editable here">
                          + advanced preserved
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRule(r._key)}
                        className="text-muted hover:text-danger"
                        aria-label={`Remove rule ${i + 1}`}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field id={`${r._key}-type`} label="Destination type">
                      <select
                        id={`${r._key}-type`}
                        className={selectClass}
                        value={r.destinationType}
                        onChange={(ev) => patchRule(r._key, { destinationType: ev.target.value as DestType })}
                      >
                        {DEST_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`${r._key}-priority`} label="Priority (order)">
                      <Input id={`${r._key}-priority`} inputMode="numeric" value={r.priority} onChange={(ev) => patchRule(r._key, { priority: ev.target.value })} />
                    </Field>
                  </div>

                  <Field id={`${r._key}-dest`} label="Destination" hint={DEST_HINT[r.destinationType]} className="mt-2">
                    <Input
                      id={`${r._key}-dest`}
                      value={r.destination}
                      maxLength={2048}
                      onChange={(ev) => patchRule(r._key, { destination: ev.target.value })}
                      className="font-mono"
                    />
                  </Field>

                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <Field id={`${r._key}-weight`} label="Weight">
                      <Input id={`${r._key}-weight`} inputMode="numeric" value={r.weight} onChange={(ev) => patchRule(r._key, { weight: ev.target.value })} placeholder="1–1000" />
                    </Field>
                    <Field id={`${r._key}-timeout`} label="Timeout (s)">
                      <Input id={`${r._key}-timeout`} inputMode="numeric" value={r.timeoutSeconds} onChange={(ev) => patchRule(r._key, { timeoutSeconds: ev.target.value })} placeholder="1–600" />
                    </Field>
                    <Field id={`${r._key}-retry`} label="Retries">
                      <Input id={`${r._key}-retry`} inputMode="numeric" value={r.retryCount} onChange={(ev) => patchRule(r._key, { retryCount: ev.target.value })} placeholder="0–10" />
                    </Field>
                  </div>

                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                    <input type="checkbox" checked={r.enabled} onChange={(ev) => patchRule(r._key, { enabled: ev.target.checked })} className="accent-[var(--accent)]" />
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
            <Button type="button" variant="secondary" size="sm" onClick={addRule}>Add rule</Button>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save rules"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
