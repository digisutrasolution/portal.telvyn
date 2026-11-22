"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { messageFor } from "@/components/auth/auth-message";
import type { LcrPolicy, CreateLcrPolicy, UpdateLcrPolicy } from "@/lib/contracts";
import { createLcrPolicy, updateLcrPolicy } from "@/lib/telecom/lcr-actions";

type Strategy = NonNullable<CreateLcrPolicy["selectionStrategy"]>;
const STRATEGY_OPTIONS: readonly Strategy[] = ["LOWEST_COST", "HIGHEST_PRIORITY", "WEIGHTED", "QUALITY_FIRST"];

const selectClass =
  "h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-45";

type Mode = { mode: "create" } | { mode: "edit"; policy: LcrPolicy };

/**
 * Create / edit an LCR policy — the policy envelope only (Phase 12O-2aj).
 * DECLARATIVE ROUTE SELECTION; nothing is executed, rated or billed. The route
 * candidates (with their integer `costMicros`) are NOT edited here: creating a
 * policy starts it with an empty route set, and editing omits `routes` so the
 * backend leaves the existing routes untouched (it only replaces them when
 * `routes` is sent). A dedicated routes editor is a later slice (12O-2ak). Edit
 * sends `expectedVersion` for optimistic concurrency — a concurrent change
 * surfaces the API's 409. The server re-checks `routing.manage` on every call.
 */
export function LcrForm(props: Mode & { onClose: () => void; onSaved: () => void }) {
  const { onClose, onSaved } = props;
  const existing = props.mode === "edit" ? props.policy : null;

  const [name, setName] = React.useState(existing?.name ?? "");
  const [description, setDescription] = React.useState(existing?.description ?? "");
  const [strategy, setStrategy] = React.useState<"" | Strategy>(existing?.selectionStrategy ?? "");
  const [enabled, setEnabled] = React.useState(existing?.enabled ?? true);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNameError(null);
    if (name.trim() === "") {
      setNameError("Name is required.");
      return;
    }

    setPending(true);
    try {
      if (existing) {
        // Edit: `routes` intentionally omitted so the backend preserves the route set.
        const body: UpdateLcrPolicy = {
          name: name.trim(),
          description: description.trim() === "" ? null : description.trim(),
          enabled,
          expectedVersion: existing.version,
        };
        if (strategy) body.selectionStrategy = strategy;
        await updateLcrPolicy(existing.id, body);
      } else {
        // Create: no `routes` → an empty route set to start.
        const body: CreateLcrPolicy = { name: name.trim(), enabled };
        if (description.trim()) body.description = description.trim();
        if (strategy) body.selectionStrategy = strategy;
        await createLcrPolicy(body);
      }
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
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogTitle>{existing ? "Edit LCR policy" : "New LCR policy"}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {existing ? "Update this policy's name, description, strategy and state." : "Add an LCR policy."}{" "}
          Declarative route selection only. {existing ? "The route candidates are managed separately and are left unchanged here." : "Route candidates are added separately after creation."}
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <Field id="lcr-name" label="Name" error={nameError}>
            <Input
              id="lcr-name"
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameError ? true : undefined}
              placeholder="UK termination"
            />
          </Field>

          <Field id="lcr-description" label="Description" hint="Optional.">
            <textarea
              id="lcr-description"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink outline-none"
              placeholder="What this policy is for…"
            />
          </Field>

          <Field id="lcr-strategy" label="Selection strategy" hint={existing ? undefined : "Defaults to Lowest cost."}>
            <select id="lcr-strategy" className={selectClass} value={strategy} onChange={(e) => setStrategy(e.target.value as "" | Strategy)}>
              <option value="">—</option>
              {STRATEGY_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[var(--accent)]" />
            Enabled
          </label>

          {error && (
            <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : existing ? "Save changes" : "Create policy"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
