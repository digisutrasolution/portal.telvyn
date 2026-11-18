"use client";

import * as React from "react";
import { Brand } from "@/components/shell/brand";
import { Button } from "@/components/ui/button";
import { Field, errorId } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api/problem";
import { setAccessToken } from "@/lib/api/token-store";
import { isMfaRequired, login, verifyMfa } from "@/lib/auth/auth-actions";
import { useSession } from "@/lib/session/session-context";

function messageFor(err: unknown): string {
  if (isApiError(err)) {
    return err.problem.detail ? `${err.problem.title} — ${err.problem.detail}` : err.problem.title;
  }
  return "Something went wrong. Please try again.";
}

type Stage = { step: "credentials" } | { step: "mfa"; mfaToken: string };

/**
 * Sign-in screen (ADR-0016). Two steps: email + password, then an MFA code when
 * the account requires it. On success the access token goes into the in-memory
 * store and the session reloads — the refresh token is set by the server as an
 * httpOnly cookie we never touch.
 */
export function LoginScreen() {
  const session = useSession();
  const [stage, setStage] = React.useState<Stage>({ step: "credentials" });
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function succeed(accessToken: string) {
    setAccessToken(accessToken);
    session.reload();
  }

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await login(email, password);
      if (isMfaRequired(result)) {
        setStage({ step: "mfa", mfaToken: result.mfaToken });
        setPending(false);
        return;
      }
      succeed(result.accessToken);
      // leave `pending` true: the session is reloading into the app.
    } catch (err) {
      setError(messageFor(err));
      setPending(false);
    }
  }

  async function onMfa(e: React.FormEvent) {
    e.preventDefault();
    if (stage.step !== "mfa") return;
    setError(null);
    setPending(true);
    try {
      const pair = await verifyMfa(stage.mfaToken, code.trim());
      succeed(pair.accessToken);
    } catch (err) {
      setError(messageFor(err));
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-elev-2">
          {stage.step === "credentials" ? (
            <form onSubmit={onCredentials} noValidate className="space-y-4">
              <div className="space-y-1">
                <h1 className="font-display text-[18px] font-semibold text-ink">Sign in</h1>
                <p className="text-[12px] text-muted">Access the Telvyn control plane.</p>
              </div>
              <Field id="login-email" label="Email">
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field id="login-password" label="Password">
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                />
              </Field>
              {error && (
                <p id={errorId("login")} role="alert" className="text-[12px] text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          ) : (
            <form onSubmit={onMfa} noValidate className="space-y-4">
              <div className="space-y-1">
                <h1 className="font-display text-[18px] font-semibold text-ink">Two-factor code</h1>
                <p className="text-[12px] text-muted">
                  Enter the 6-digit code from your authenticator, or a recovery code.
                </p>
              </div>
              <Field id="login-mfa" label="Authentication code">
                <Input
                  id="login-mfa"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={pending}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId("login") : undefined}
                />
              </Field>
              {error && (
                <p id={errorId("login")} role="alert" className="text-[12px] text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
                {pending ? "Verifying…" : "Verify"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={pending}
                onClick={() => {
                  setStage({ step: "credentials" });
                  setError(null);
                  setCode("");
                }}
              >
                Back
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
