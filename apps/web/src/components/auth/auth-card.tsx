import * as React from "react";
import { Brand } from "@/components/shell/brand";

/** Centered brand + card shell shared by the sign-in, reset, and verify screens. */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-elev-2">{children}</div>
      </main>
    </div>
  );
}
