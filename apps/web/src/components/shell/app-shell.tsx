"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellProvider } from "./shell-provider";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";

/** Application shell: theme + tooltip + shell state providers, rail, topbar, palette. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <ShellProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-elev-2"
          >
            Skip to main content
          </a>
          <div className="flex min-h-dvh">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
                {children}
              </main>
            </div>
          </div>
          <CommandPalette />
        </ShellProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
