"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/lib/session/session-context";

/**
 * Client root: theme + tooltip + session providers, then the auth gate. The
 * sign-in screen and the application shell both live under theme/tooltip so
 * either renders correctly; only authenticated sessions reach <AppShell>.
 */
export function AppProviders({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <TooltipProvider delayDuration={300}>
        <SessionProvider>
          <AuthBoundary>
            <AppShell>{children}</AppShell>
          </AuthBoundary>
        </SessionProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
