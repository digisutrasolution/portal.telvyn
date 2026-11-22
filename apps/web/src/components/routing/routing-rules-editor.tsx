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

const DAY_LABELS: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * An editable rule. Numeric fields are held as strings for clean input. Failover
 * (destination + type + after-seconds) and the time-of-day schedule are editable
 * here (Phase 12O-2ap); only the `carrierId` tag is still carried through verbatim
 * (there is no per-rule carrier picker yet) so a save — which REPLACES the whole
 * rule set — never silently drops it.
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
  // typed failover (editable):
  failoverDestinationType: "" | DestType;
  failoverDestination: string;
  failoverAfterSeconds: string;
  // time-of-day schedule (editable):
  scheduleEnabled: boolean;
  scheduleTz: string;
  scheduleDays: number[];
  scheduleStart: string; // "HH:MM"
  scheduleEnd: string; // "HH:MM"
  // preserved, not edited here:
  carrierId: string | null;
};

let keySeq = 0;
const nextKey = () => `r${keySeq++}`;

/** Minutes-of-day → "HH:MM" (zero-padded). */
function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
/** "HH:MM" → minutes-of-day (0–1439), or null if malformed. */
function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fromRule(r: RoutingRule): EditRule {
  const s = (r.schedule ?? null) as null | Record<string, unknown>;
  const days = s && Array.isArray(s.daysOfWeek) ? (s.daysOfWeek as number[]) : [];
  return {
    _key: nextKey(),
    destinationType: r.destinationType,
    destination: r.destination,
    priority: String(r.priority),
    weight: r.weight != null ? String(r.weight) : "",
    enabled: r.enabled,
    timeoutSeconds: r.timeoutSeconds != null ? String(r.timeoutSeconds) : "",
    retryCount: r.retryCount != null ? String(r.retryCount) : "",
    failoverDestinationType: r.failoverDestinationType ?? "",
    failoverDestination: r.failoverDestination ?? "",
    failoverAfterSeconds: r.failoverAfterSeconds != null ? String(r.failoverAfterSeconds) : "",
    scheduleEnabled: s != null,
    scheduleTz: s && typeof s.timezone === "string" ? s.timezone : "",
    scheduleDays: days,
    scheduleStart: s && typeof s.startMinute === "number" ? minutesToHHMM(s.startMinute) : "",
    scheduleEnd: s && typeof s.endMinute === "number" ? minutesToHHMM(s.endMinute) : "",
    carrierId: r.carrierId,
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
    failoverDestinationType: "",
    failoverDestination: "",
    failoverAfterSeconds: "",
    scheduleEnabled: false,
    scheduleTz: "",
    scheduleDays: [],
    scheduleStart: "",
    scheduleEnd: "",
    carrierId: null,
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

  // Typed failover — a destination + its type go together (the server also rejects
  // failing over to a rule's own destination). After-seconds is optional (1–600).
  const foDest = e.failoverDestination.trim();
  if (e.failoverDestinationType !== "" || foDest !== "") {
    if (e.failoverDestinationType === "") return { error: { index, message: "Failover needs a destination type." } };
    if (foDest === "") return { error: { index, message: "Failover needs a destination value." } };
    out.failoverDestinationType = e.failoverDestinationType;
    out.failoverDestination = foDest;
    const fas = parseIntField(e.failoverAfterSeconds);
    if (fas !== null) {
      if (!Number.isInteger(fas) || fas < 1 || fas > 600) return { error: { index, message: "Failover after-seconds must be between 1 and 600." } };
      out.failoverAfterSeconds = fas;
    }
  }

  // Time-of-day schedule — all-or-nothing when enabled.
  if (e.scheduleEnabled) {
    const tz = e.scheduleTz.trim();
    if (tz === "") return { error: { index, message: "Schedule needs a timezone (e.g. America/New_York)." } };
    if (e.scheduleDays.length === 0) return { error: { index, message: "Schedule needs at least one day." } };
    const startMinute = hhmmToMinutes(e.scheduleStart);
    const endMinute = hhmmToMinutes(e.scheduleEnd);
    if (startMinute === null || endMinute === null) return { error: { index, message: "Schedule needs a valid start and end time." } };
    if (startMinute >= endMinute) return { error: { index, message: "Schedule start must be before end." } };
    out.schedule = { timezone: tz, daysOfWeek: [...e.scheduleDays].sort((a, b) => a - b), startMinute, endMinute };
  }

  // Carrier tag is not editable here (no per-rule picker yet) — carry it through.
  if (e.carrierId) out.carrierId = e.carrierId;
  return out;
}

/**
 * Routing rules editor (Phase 12O-2ai; typed failover + schedule editing added in
 * 12O-2ap). Edits a profile's ordered rule set and saves it via PATCH, which
 * REPLACES the whole set — so the editor loads every current rule and sends them
 * all back, and `expectedVersion` guards against a concurrent change (409). Editable
 * per rule: destination type + value, priority/order, enabled, weight, timeout,
 * retries, a typed FAILOVER (destination + type, with optional after-seconds), and a
 * time-of-day SCHEDULE (timezone, days, start/end). The only field still not editable
 * is the `carrierId` tag (no per-rule carrier picker yet) — it is PRESERVED untouched
 * on existing rules (a chip marks a rule that carries one). Destinations and the
 * timezone are validated server-side (and the server rejects a rule failing over to
 * its own destination); `routing.manage` is re-checked there.
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

  const hasPreserved = (r: EditRule) => Boolean(r.carrierId);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Edit rules — {profile.name}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          Declarative configuration only; nothing is dialled. Rules are tried in priority order (ascending).
          A rule's carrier tag (if any) is preserved; everything else — including failover and schedule — is editable here.
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
                        <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted" title="This rule has a carrier tag preserved but not editable here">
                          + carrier preserved
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

                  {/* Typed failover — destination + type together; after-seconds optional. */}
                  <div className="mt-3 rounded-md border border-line px-3 pb-3 pt-2">
                    <p className="mb-1.5 text-[12px] font-medium text-ink-2">Failover (optional)</p>
                    <div className="grid grid-cols-3 gap-3">
                      <Field id={`${r._key}-fo-type`} label="Failover type">
                        <select
                          id={`${r._key}-fo-type`}
                          className={selectClass}
                          value={r.failoverDestinationType}
                          onChange={(ev) => patchRule(r._key, { failoverDestinationType: ev.target.value as "" | DestType })}
                        >
                          <option value="">— none</option>
                          {DEST_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </Field>
                      <Field id={`${r._key}-fo-dest`} label="Failover destination" hint={r.failoverDestinationType ? DEST_HINT[r.failoverDestinationType] : undefined}>
                        <Input
                          id={`${r._key}-fo-dest`}
                          value={r.failoverDestination}
                          maxLength={2048}
                          disabled={r.failoverDestinationType === ""}
                          onChange={(ev) => patchRule(r._key, { failoverDestination: ev.target.value })}
                          className="font-mono"
                        />
                      </Field>
                      <Field id={`${r._key}-fo-after`} label="After (s)">
                        <Input
                          id={`${r._key}-fo-after`}
                          inputMode="numeric"
                          value={r.failoverAfterSeconds}
                          disabled={r.failoverDestinationType === ""}
                          onChange={(ev) => patchRule(r._key, { failoverAfterSeconds: ev.target.value })}
                          placeholder="1–600"
                        />
                      </Field>
                    </div>
                  </div>

                  {/* Time-of-day schedule — all-or-nothing when enabled. */}
                  <div className="mt-2 rounded-md border border-line px-3 pb-3 pt-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={r.scheduleEnabled}
                        onChange={(ev) => patchRule(r._key, { scheduleEnabled: ev.target.checked })}
                        className="accent-[var(--accent)]"
                      />
                      Restrict to a schedule
                    </label>
                    {r.scheduleEnabled && (
                      <div className="mt-2 space-y-2">
                        <Field id={`${r._key}-sch-tz`} label="Timezone" hint="IANA, e.g. America/New_York">
                          <Input id={`${r._key}-sch-tz`} value={r.scheduleTz} maxLength={64} onChange={(ev) => patchRule(r._key, { scheduleTz: ev.target.value })} className="font-mono" />
                        </Field>
                        <div>
                          <p className="mb-1 text-[12px] font-medium text-ink-2">Days</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {DAY_LABELS.map((lbl, dayNum) => (
                              <label key={dayNum} className="flex cursor-pointer items-center gap-1 text-[13px] text-ink-2">
                                <input
                                  type="checkbox"
                                  checked={r.scheduleDays.includes(dayNum)}
                                  onChange={() =>
                                    patchRule(r._key, {
                                      scheduleDays: r.scheduleDays.includes(dayNum)
                                        ? r.scheduleDays.filter((d) => d !== dayNum)
                                        : [...r.scheduleDays, dayNum],
                                    })
                                  }
                                  className="accent-[var(--accent)]"
                                />
                                {lbl}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Field id={`${r._key}-sch-start`} label="From">
                            <Input id={`${r._key}-sch-start`} type="time" value={r.scheduleStart} onChange={(ev) => patchRule(r._key, { scheduleStart: ev.target.value })} />
                          </Field>
                          <Field id={`${r._key}-sch-end`} label="To">
                            <Input id={`${r._key}-sch-end`} type="time" value={r.scheduleEnd} onChange={(ev) => patchRule(r._key, { scheduleEnd: ev.target.value })} />
                          </Field>
                        </div>
                      </div>
                    )}
                  </div>

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
