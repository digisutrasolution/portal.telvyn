"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { isPublicAuthPath } from "@/components/auth/public-paths";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/lib/session/session-context";

/**
 * Client root. Theme + tooltip wrap everything. Public token routes (password
 * reset, email verification) render themed but bare — no session provider, no
 * auth gate, no shell. Every other route runs under the session provider, the
 * auth gate, and (when authenticated) the application shell.
 */
export function AppProviders({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  const isPublic = isPublicAuthPath(usePathname());

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <TooltipProvider delayDuration={300}>
        {isPublic ? (
          children
        ) : (
          <SessionProvider>
            <AuthBoundary>
              <AppShell>{children}</AppShell>
            </AuthBoundary>
          </SessionProvider>
        )}
      </TooltipProvider>
    </ThemeProvider>
  );
}
