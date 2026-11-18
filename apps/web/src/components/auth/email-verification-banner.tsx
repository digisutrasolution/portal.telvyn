"use client";

import * as React from "react";
import { MailWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/problem";
import { getMe, requestEmailVerification } from "@/lib/auth/auth-actions";
import { useResource } from "@/lib/use-resource";

/**
 * A quiet nudge shown in the authenticated app when the signed-in user's email
 * is not yet verified, with a resend action. Reads identity from GET /v1/auth/me
 * (emailVerified is not on /v1/me/context). Renders nothing while loading, on
 * error, or once verified. Dismissible for the session only.
 */
export function EmailVerificationBanner() {
  const { data } = useResource(getMe);
  const [dismissed, setDismissed] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!data || data.emailVerified || dismissed) return null;

  async function resend() {
    setSending(true);
    setError(null);
    try {
      await requestEmailVerification();
      setSent(true);
    } catch (err) {
      setError(isApiError(err) ? err.problem.title : "Couldn't send the email. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div role="status" className="flex items-center gap-3 border-b border-warn bg-warn-soft px-4 py-2 text-[12px] text-warn md:px-6">
      <MailWarning aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />
      <p className="min-w-0 flex-1">
        {sent ? (
          <>Verification email sent to <span className="font-medium">{data.email}</span>. Check your inbox.</>
        ) : error ? (
          error
        ) : (
          <>Your email <span className="font-medium">{data.email}</span> isn&apos;t verified yet.</>
        )}
      </p>
      {!sent && (
        <Button variant="ghost" size="sm" className="shrink-0 text-warn hover:text-warn" disabled={sending} onClick={resend}>
          {sending ? "Sending…" : "Resend email"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-warn hover:text-warn"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X aria-hidden className="size-4" strokeWidth={1.8} />
      </Button>
    </div>
  );
}
