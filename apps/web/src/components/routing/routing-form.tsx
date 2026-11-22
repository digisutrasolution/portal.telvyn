"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { RoutingProfile, CreateRoutingProfile, UpdateRoutingProfile } from "@/lib/contracts";
import { createRoutingProfile, updateRoutingProfile } from "@/lib/telecom/routing-actions";

type Direction = NonNullable<CreateRoutingProfile["direction"]>;
type Status = NonNullable<CreateRoutingProfile["status"]>;
type Strategy = NonNullable<CreateRoutingProfile["selectionStrategy"]>;
type FailoverCondition = NonNullable<CreateRoutingProfile["failoverConditions"]>[number];

const DIRECTION_OPTIONS: readonly Direction[] = ["INBOUND", "OUTBOUND"];
const STATUS_OPTIONS: readonly Status[] = ["ACTIVE", "SUSPENDED", "DISABLED"];
const STRATEGY_OPTIONS: readonly Strategy[] = ["PRIORITY", "WEIGHTED", "ROUND_ROBIN", "SIMULTANEOUS"];
const CONDITION_OPTIONS: readonly FailoverCondition[] = ["NO_ANSWER", "BUSY", "FAILED", "UNREACHABLE", "TIMEOUT"];

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type Mode = { mode: "create" } | { mode: "edit"; profile: RoutingProfile };

/** A numeric string → integer; null when blank; NaN when non-integer (caller validates). */
function parseIntField(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Create / edit a routing profile — the profile envelope and its selection /
 * failover POLICY (Phase 12O-2ah). DECLARATIVE CONFIGURATION ONLY; nothing is
 * executed. The ordered rule set is intentionally NOT edited here: creating a
 * profile starts it with an empty rule set, and editing omits `rules` so the
 * backend leaves the existing rules untouched (it only replaces them when `rules`
 * is sent). A dedicated rules editor is a later slice (12O-2ai). Edit sends
 * `expectedVersion` for optimistic concurrency — a concurrent change surfaces the
 * API's 409. The server re-checks `routing.manage` and re-validates on every call,
 * including the "failover enabled ⇒ at least one condition" rule mirrored here.
 */
export function RoutingForm(props: Mode & { onClose: () => void; onSaved: () => void }) {
  const { onClose, onSaved } = props;
  const existing = props.mode === "edit" ? props.profile : null;

  const [name, setName] = React.useState(existing?.name ?? "");
  const [direction, setDirection] = React.useState<"" | Direction>(existing?.direction ?? "");
  const [description, setDescription] = React.useState(existing?.description ?? "");
  const [status, setStatus] = React.useState<"" | Status>(existing?.status ?? "");

  const [strategy, setStrategy] = React.useState<"" | Strategy>(existing?.policy.selectionStrategy ?? "");
  const [failoverEnabled, setFailoverEnabled] = React.useState(existing?.policy.failoverEnabled ?? false);
  const [conditions, setConditions] = React.useState<FailoverCondition[]>(existing?.policy.failoverConditions ?? []);
  const [maxAttempts, setMaxAttempts] = React.useState(existing?.policy.maxAttempts != null ? String(existing.policy.maxAttempts) : "");
  const [overallTimeout, setOverallTimeout] = React.useState(
    existing?.policy.overallTimeoutSeconds != null ? String(existing.policy.overallTimeoutSeconds) : "",
  );

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ field: string; message: string } | null>(null);

  function toggleCondition(c: FailoverCondition) {
    setConditions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  /** Shared validation; returns a field error or the parsed policy numerics. */
  function validate(): { error: { field: string; message: string } } | { maxAttempts?: number; overallTimeoutSeconds?: number } {
    if (name.trim() === "") return { error: { field: "name", message: "Name is required." } };
    if (failoverEnabled && conditions.length === 0) {
      return { error: { field: "failoverConditions", message: "Enable failover with at least one condition." } };
    }
    const out: { maxAttempts?: number; overallTimeoutSeconds?: number } = {};
    const ma = parseIntField(maxAttempts);
    if (ma !== null) {
      if (!Number.isInteger(ma) || ma < 1 || ma > 20) return { error: { field: "maxAttempts", message: "Enter a whole number between 1 and 20." } };
      out.maxAttempts = ma;
    }
    const ot = parseIntField(overallTimeout);
    if (ot !== null) {
      if (!Number.isInteger(ot) || ot < 1 || ot > 3600) return { error: { field: "overallTimeoutSeconds", message: "Enter a whole number between 1 and 3600." } };
      out.overallTimeoutSeconds = ot;
    }
    return out;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const v = validate();
    if ("error" in v) {
      setFieldError(v.error);
      return;
    }

    setPending(true);
    try {
      if (existing) {
        // Edit: `rules` is intentionally omitted so the backend preserves the rule set.
        const body: UpdateRoutingProfile = {
          name: name.trim(),
          description: description.trim() === "" ? null : description.trim(),
          failoverEnabled,
          failoverConditions: conditions,
          expectedVersion: existing.version,
        };
        if (direction) body.direction = direction;
        if (status) body.status = status;
        if (strategy) body.selectionStrategy = strategy;
        if (v.maxAttempts !== undefined) body.maxAttempts = v.maxAttempts;
        if (v.overallTimeoutSeconds !== undefined) body.overallTimeoutSeconds = v.overallTimeoutSeconds;
        await updateRoutingProfile(existing.id, body);
      } else {
        // Create: no `rules` → an empty rule set to start.
        const body: CreateRoutingProfile = {
          name: name.trim(),
          failoverEnabled,
          failoverConditions: conditions,
        };
        if (direction) body.direction = direction;
        if (description.trim()) body.description = description.trim();
        if (status) body.status = status;
        if (strategy) body.selectionStrategy = strategy;
        if (v.maxAttempts !== undefined) body.maxAttempts = v.maxAttempts;
        if (v.overallTimeoutSeconds !== undefined) body.overallTimeoutSeconds = v.overallTimeoutSeconds;
        await createRoutingProfile(body);
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
        <DialogTitle>{existing ? "Edit routing profile" : "New routing profile"}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {existing ? "Update this profile and its selection / failover policy." : "Add a routing profile and its policy."}{" "}
          Declarative configuration only. {existing ? "The rule set is managed separately and is left unchanged here." : "Rules are added separately after creation."}
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <Field id="rp-name" label="Name" error={fe("name")}>
            <Input
              id="rp-name"
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fe("name") ? true : undefined}
              placeholder="Inbound main"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="rp-direction" label="Direction">
              <select id="rp-direction" className={selectClass} value={direction} onChange={(e) => setDirection(e.target.value as "" | Direction)}>
                <option value="">—</option>
                {DIRECTION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field id="rp-status" label="Status" hint={existing ? undefined : "Defaults to Active."}>
              <select id="rp-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as "" | Status)}>
                <option value="">—</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field id="rp-description" label="Description" hint="Optional.">
            <textarea
              id="rp-description"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink outline-none"
              placeholder="What this profile is for…"
            />
          </Field>

          <fieldset className="rounded-md border border-line px-3 pb-3 pt-2">
            <legend className="px-1 text-[12px] font-medium text-ink-2">Policy</legend>

            <Field id="rp-strategy" label="Selection strategy" hint={existing ? undefined : "Defaults to Priority."}>
              <select id="rp-strategy" className={selectClass} value={strategy} onChange={(e) => setStrategy(e.target.value as "" | Strategy)}>
                <option value="">—</option>
                {STRATEGY_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={failoverEnabled} onChange={(e) => setFailoverEnabled(e.target.checked)} className="accent-[var(--accent)]" />
              Enable failover
            </label>

            <div className="mt-2">
              <p className="mb-1.5 text-[12px] font-medium text-ink-2">
                Failover conditions{fe("failoverConditions") && <span className="ml-2 font-normal text-danger">{fe("failoverConditions")}</span>}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {CONDITION_OPTIONS.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
                    <input type="checkbox" checked={conditions.includes(c)} onChange={() => toggleCondition(c)} className="accent-[var(--accent)]" />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field id="rp-maxattempts" label="Max attempts" error={fe("maxAttempts")}>
                <Input id="rp-maxattempts" inputMode="numeric" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} aria-invalid={fe("maxAttempts") ? true : undefined} placeholder="1–20" />
              </Field>
              <Field id="rp-timeout" label="Overall timeout (s)" error={fe("overallTimeoutSeconds")}>
                <Input id="rp-timeout" inputMode="numeric" value={overallTimeout} onChange={(e) => setOverallTimeout(e.target.value)} aria-invalid={fe("overallTimeoutSeconds") ? true : undefined} placeholder="1–3600" />
              </Field>
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
              {pending ? "Saving…" : existing ? "Save changes" : "Create profile"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
