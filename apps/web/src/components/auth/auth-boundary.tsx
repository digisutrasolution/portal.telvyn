"use client";

import * as React from "react";
import { Brand } from "@/components/shell/brand";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session/session-context";
import { LoginScreen } from "./login-screen";

function CenteredNotice({ title, body, actions }: { title: string; body: string; actions?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <main className="w-full max-w-sm text-center">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <h1 className="font-display text-[16px] font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-[13px] text-muted">{body}</p>
        {actions && <div className="mt-5 flex justify-center gap-2">{actions}</div>}
      </main>
    </div>
  );
}

/**
 * Gates the application shell on the session status (ADR-0016). Unauthenticated
 * sessions see the sign-in screen instead of the shell chrome; authenticated
 * sessions see the app. This is UX gating — the server remains the authority on
 * every request.
 */
export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const session = useSession();

  switch (session.status) {
    case "authenticated":
      return <>{children}</>;
    case "unauthenticated":
      return <LoginScreen />;
    case "forbidden":
      return (
        <CenteredNotice
          title="No workspace access"
          body="Your account is signed in but isn't a member of an active workspace. Contact an administrator."
          actions={
            <Button variant="secondary" onClick={() => void session.signOut()}>
              Sign out
            </Button>
          }
        />
      );
    case "error":
      return (
        <CenteredNotice
          title="Can't reach the server"
          body="We couldn't load your session. Check your connection and try again."
          actions={
            <Button variant="primary" onClick={() => session.reload()}>
              Retry
            </Button>
          }
        />
      );
    case "loading":
    default:
      return <CenteredNotice title="Telvyn" body="Loading your session…" />;
  }
}
