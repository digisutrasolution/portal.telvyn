"use client";

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useResource } from "@/lib/use-resource";
import { messageFor } from "@/components/auth/auth-message";
import { disableMfa, enableMfa, enrollMfa, getMe } from "@/lib/auth/auth-actions";
import type { MfaEnrollResult } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/** Pull the base32 shared secret from an otpauth:// URI for manual key entry. */
function secretFromOtpauth(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Local flow state layered over the server's `mfaEnabled` fact. */
type Flow =
  | { step: "idle" }
  | { step: "enrolling"; enroll: MfaEnrollResult }
  | { step: "recovery"; codes: string[] };

/**
 * Two-factor authentication management (Phase 12O-2k). Reads the authoritative
 * `mfaEnabled` from GET /v1/auth/me and drives the contracted lifecycle:
 * enroll (otpauth URI) → prove a code to enable (one-time recovery codes) →
 * step-up disable (current password AND a code). The server enforces every
 * rule; this screen is UX only. Recovery codes are shown exactly once.
 */
export function MfaSettings() {
  const me = useResource(getMe);
  const [flow, setFlow] = React.useState<Flow>({ step: "idle" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [disableOpen, setDisableOpen] = React.useState(false);

  async function onSetup() {
    setBusy(true);
    setError(null);
    try {
      const enroll = await enrollMfa();
      setFlow({ step: "enrolling", enroll });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function onEnable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      const { recoveryCodes } = await enableMfa(code);
      setCode("");
      setFlow({ step: "recovery", codes: recoveryCodes });
      me.reload();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelEnroll() {
    setCode("");
    setError(null);
    setFlow({ step: "idle" });
  }

  // --- enrollment: show the key, collect a code ---
  if (flow.step === "enrolling") {
    const secret = secretFromOtpauth(flow.enroll.otpauthUri);
    return (
      <Section>
        <h2 className="text-[14px] font-semibold text-ink">Set up two-factor authentication</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit
          code it shows to finish. Two-factor isn&apos;t on until you confirm a code.
        </p>
        <figure className="mt-4 flex flex-col items-center gap-2">
          {/* Dark-on-white with a quiet zone, regardless of theme, so it always scans. */}
          <div className="rounded-lg border border-line bg-white p-3">
            <QRCodeSVG
              value={flow.enroll.otpauthUri}
              size={168}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#0a0a0a"
              title="Two-factor authentication setup QR code"
            />
          </div>
        </figure>
        <Field
          id="mfa-secret"
          label="Can't scan? Enter this key manually"
          className="mt-4"
          hint="Type this setup key into your authenticator app instead of scanning."
        >
          <Input id="mfa-secret" readOnly value={secret ?? flow.enroll.otpauthUri} className="font-mono tracking-wide" />
        </Field>
        <form onSubmit={onEnable} noValidate className="mt-4 space-y-4">
          <Field id="mfa-code" label="6-digit code" error={error}>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "mfa-code-error" : undefined}
              className="font-mono tracking-[0.3em]"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? "Verifying…" : "Turn on two-factor"}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={cancelEnroll} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </Section>
    );
  }

  // --- recovery codes: one-time reveal after enabling ---
  if (flow.step === "recovery") {
    return (
      <Section>
        <h2 className="text-[14px] font-semibold text-ok">Two-factor authentication is on</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Save these recovery codes somewhere safe. Each one signs you in once if you lose your authenticator. They
          won&apos;t be shown again.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Recovery codes">
          {flow.codes.map((c) => (
            <li key={c} className="rounded-md border border-line bg-surface-2 px-3 py-2 text-center font-mono text-[13px] text-ink">
              {c}
            </li>
          ))}
        </ul>
        <Button variant="primary" size="lg" className="mt-4" onClick={() => setFlow({ step: "idle" })}>
          I&apos;ve saved my codes
        </Button>
      </Section>
    );
  }

  // --- idle: current status ---
  if (me.loading && !me.data) {
    return (
      <Section>
        <p className="text-[13px] text-muted">Loading…</p>
      </Section>
    );
  }
  if (me.error || !me.data) {
    return (
      <Section>
        <p role="alert" className="text-[13px] text-danger">
          {me.error ?? "Couldn't load your security settings."}
        </p>
      </Section>
    );
  }

  const enabled = me.data.mfaEnabled;
  return (
    <Section>
      <div className="flex items-start gap-3">
        {enabled ? (
          <ShieldCheck aria-hidden strokeWidth={1.5} className="mt-0.5 size-5 text-ok" />
        ) : (
          <ShieldOff aria-hidden strokeWidth={1.5} className="mt-0.5 size-5 text-muted" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ink">Two-factor authentication</h2>
          <p className={cn("mt-0.5 text-[13px]", enabled ? "text-ok" : "text-ink-2")}>
            {enabled
              ? "On — a code from your authenticator app is required at sign-in."
              : "Off — add a time-based code for an extra layer at sign-in."}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12px] text-danger">
          {error}
        </p>
      )}

      <div className="mt-4">
        {enabled ? (
          <Button variant="danger" size="lg" onClick={() => setDisableOpen(true)}>
            Turn off two-factor
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={onSetup} disabled={busy}>
            {busy ? "Starting…" : "Set up two-factor"}
          </Button>
        )}
      </div>

      <DisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => {
          setDisableOpen(false);
          me.reload();
        }}
      />
    </Section>
  );
}

/** Step-up confirm to disable MFA: current password AND a valid code. */
function DisableDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setCode("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password || !code) {
      setError("Enter your password and a verification code.");
      return;
    }
    setBusy(true);
    try {
      await disableMfa(password, code);
      onDisabled();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Turn off two-factor authentication</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          This lowers your account security. Confirm with your current password and a code from your authenticator app
          (or a recovery code).
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <Field id="mfa-off-password" label="Current password">
            <Input
              id="mfa-off-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field id="mfa-off-code" label="Authenticator or recovery code" error={error}>
            <Input
              id="mfa-off-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "mfa-off-code-error" : undefined}
              className="font-mono"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" disabled={busy}>
              {busy ? "Turning off…" : "Turn off"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-line bg-surface p-5 shadow-elev-1">{children}</section>;
}
