"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api/problem";
import { messageFor } from "@/components/auth/auth-message";
import type { EngineHealthReport, SyncOutcome } from "@/lib/contracts";
import { checkEngineHealth, rollbackEngine, syncEngine } from "@/lib/telecom/telecom-actions";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils";

type Tone = "ok" | "info" | "warn" | "danger";
type Result = { tone: Tone; message: string } | null;
type Confirm = { action: "sync" | "rollback" } | null;

const RESULT_CLASS: Record<Tone, string> = {
  ok: "border-ok text-ok",
  info: "border-line text-ink-2",
  warn: "border-warn text-warn",
  danger: "border-danger text-danger",
};

function errorTone(err: unknown): Tone {
  if (isApiError(err)) {
    if (err.status === 501) return "info"; // expected with a stub adapter — honest, not a failure
    if (err.status === 400 || err.status === 409 || err.status >= 500) return "warn";
    return "danger";
  }
  return "danger";
}

const CONFIRM_COPY = {
  sync: {
    title: "Sync configuration",
    body: "This attempts to push the engine's desired configuration to it. With a stub adapter it is a no-op (not implemented); once a real connector is wired it changes engine state.",
    cta: "Sync",
    variant: "primary" as const,
  },
  rollback: {
    title: "Roll back configuration",
    body: "This rolls the engine back to its previous desired configuration version. Once a real connector is wired it changes engine state.",
    cta: "Roll back",
    variant: "danger" as const,
  },
};

/**
 * Mutating engine actions (ADR-0019). Health-check is non-destructive and fires
 * directly; sync and rollback are state-changing, gated on `telecom.manage`, and
 * confirmed first with a type-to-confirm guard — the operator must type the exact
 * engine name before the action is enabled (defence against a mis-click once a
 * real connector is wired). Results (including the honest 501 under the Null
 * connector) are shown plainly. The API re-checks permission + platform on every
 * call; this guard is UX only.
 */
export function EngineActions({
  engineId,
  engineName,
  onChanged,
}: {
  engineId: string;
  engineName: string;
  onChanged: () => void;
}) {
  const { hasPermission } = useSession();
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<Result>(null);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [confirmText, setConfirmText] = React.useState("");

  // Reset the typed confirmation whenever the dialog opens on a new action or closes.
  React.useEffect(() => {
    setConfirmText("");
  }, [confirm]);

  const canHealth = hasPermission("telecom.health.read");
  const canManage = hasPermission("telecom.manage");
  if (!canHealth && !canManage) return null;

  const confirmMatches = confirmText.trim() === engineName;

  async function run(fn: () => Promise<EngineHealthReport | SyncOutcome>, describe: (r: never) => string) {
    setPending(true);
    setResult(null);
    try {
      const r = await fn();
      setResult({ tone: "ok", message: describe(r as never) });
    } catch (err) {
      setResult({ tone: errorTone(err), message: messageFor(err) });
    } finally {
      setPending(false);
      onChanged();
    }
  }

  function onConfirm() {
    if (!confirmMatches) return; // guard: the CTA is disabled until the name matches
    const action = confirm?.action;
    setConfirm(null);
    if (action === "sync") {
      void run(() => syncEngine(engineId), (r: SyncOutcome) => `Sync: ${r.outcome} — ${r.syncState}${r.changed ? " (changed)" : ""}`);
    } else if (action === "rollback") {
      void run(() => rollbackEngine(engineId), (r: SyncOutcome) => `Rollback: ${r.outcome} — ${r.syncState}`);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {canHealth && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () => checkEngineHealth(engineId),
                (r: EngineHealthReport) => `Health probe: ${r.status} (${r.reachability})`,
              )
            }
          >
            Check health
          </Button>
        )}
        {canManage && (
          <>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm({ action: "sync" })}>
              Sync configuration
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirm({ action: "rollback" })}>
              Roll back
            </Button>
          </>
        )}
      </div>

      {result && (
        <p role="status" className={cn("mt-3 rounded-md border px-3 py-2 text-[12px]", RESULT_CLASS[result.tone])}>
          {result.message}
        </p>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          {confirm && (
            <>
              <DialogTitle>{CONFIRM_COPY[confirm.action].title}</DialogTitle>
              <DialogDescription className="text-[13px] text-ink-2">
                {CONFIRM_COPY[confirm.action].body}
              </DialogDescription>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
              >
                <Field
                  id="engine-confirm"
                  label="Confirm engine name"
                  className="mt-4"
                  hint={`Type ${engineName} to enable this action.`}
                >
                  <Input
                    id="engine-confirm"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={engineName}
                  />
                </Field>
                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant={CONFIRM_COPY[confirm.action].variant} size="sm" disabled={!confirmMatches}>
                    {CONFIRM_COPY[confirm.action].cta}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
