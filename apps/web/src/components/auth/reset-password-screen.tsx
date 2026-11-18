"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, errorId } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { confirmPasswordReset, requestPasswordReset } from "@/lib/auth/auth-actions";
import { AuthCard } from "./auth-card";
import { messageFor } from "./auth-message";

const MIN_PASSWORD = 12;

function SignInLink({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/" className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">
      {children}
    </Link>
  );
}

/**
 * Password reset (ADR-0016 addendum, Phase 12O-2d). A public route reached from
 * "Forgot password?" (no token → request an email) and from the emailed link
 * (`?token=…` → set a new password). The request step always reports success,
 * whether or not the account exists — the server never reveals existence.
 */
export function ResetPasswordScreen({ token }: { token?: string }) {
  const hasToken = typeof token === "string" && token.length > 0;
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await requestPasswordReset(email);
      setDone(true);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    try {
      await confirmPasswordReset(token as string, password);
      setDone(true);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <AuthCard>
        <div className="space-y-3">
          <h1 className="font-display text-[18px] font-semibold text-ink">
            {hasToken ? "Password updated" : "Check your email"}
          </h1>
          <p className="text-[13px] text-muted">
            {hasToken
              ? "Your password has been changed and all sessions were signed out."
              : "If an account exists for that address, we've sent a link to reset the password."}
          </p>
          <SignInLink>Back to sign in</SignInLink>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      {hasToken ? (
        <form onSubmit={onConfirm} noValidate className="space-y-4">
          <div className="space-y-1">
            <h1 className="font-display text-[18px] font-semibold text-ink">Set a new password</h1>
            <p className="text-[12px] text-muted">Choose a password of at least {MIN_PASSWORD} characters.</p>
          </div>
          <Field id="reset-password" label="New password">
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </Field>
          <Field id="reset-confirm" label="Confirm new password">
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={pending}
            />
          </Field>
          {error && (
            <p id={errorId("reset")} role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? "Updating…" : "Update password"}
          </Button>
        </form>
      ) : (
        <form onSubmit={onRequest} noValidate className="space-y-4">
          <div className="space-y-1">
            <h1 className="font-display text-[18px] font-semibold text-ink">Reset your password</h1>
            <p className="text-[12px] text-muted">We'll email you a link to set a new password.</p>
          </div>
          <Field id="reset-email" label="Email">
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </Field>
          {error && (
            <p id={errorId("reset")} role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
          <div className="text-center">
            <SignInLink>Back to sign in</SignInLink>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
