"use client";

import * as React from "react";
import Link from "next/link";
import { confirmEmailVerification } from "@/lib/auth/auth-actions";
import { AuthCard } from "./auth-card";
import { messageFor } from "./auth-message";

type State = { step: "verifying" } | { step: "done" } | { step: "error"; message: string } | { step: "no-token" };

/**
 * Email verification (ADR-0016 addendum, Phase 12O-2d). A public route reached
 * from the emailed link (`?token=…`); it confirms ownership on mount and shows
 * the result. Idempotent to a double-click (StrictMode fires the effect twice):
 * a ref guards against a duplicate confirm.
 */
export function VerifyEmailScreen({ token }: { token?: string }) {
  const hasToken = typeof token === "string" && token.length > 0;
  const [state, setState] = React.useState<State>(hasToken ? { step: "verifying" } : { step: "no-token" });
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!hasToken || started.current) return;
    started.current = true;
    const ac = new AbortController();
    confirmEmailVerification(token as string, ac.signal)
      .then(() => setState({ step: "done" }))
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setState({ step: "error", message: messageFor(err) });
      });
    return () => ac.abort();
  }, [hasToken, token]);

  const { title, body } = ((): { title: string; body: string } => {
    switch (state.step) {
      case "verifying":
        return { title: "Verifying your email…", body: "One moment." };
      case "done":
        return { title: "Email verified", body: "Your email address has been confirmed." };
      case "error":
        return { title: "Verification failed", body: state.message };
      case "no-token":
      default:
        return { title: "Invalid link", body: "This verification link is missing its token." };
    }
  })();

  return (
    <AuthCard>
      <div className="space-y-3">
        <h1 className="font-display text-[18px] font-semibold text-ink">{title}</h1>
        <p className="text-[13px] text-muted" role={state.step === "error" ? "alert" : undefined}>
          {body}
        </p>
        {state.step !== "verifying" && (
          <Link href="/" className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Continue to sign in
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
