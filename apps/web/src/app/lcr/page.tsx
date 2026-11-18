import type { Metadata } from "next";
import { LcrView } from "@/components/lcr/lcr-view";

export const metadata: Metadata = { title: "LCR" };

/**
 * LCR — tenant least-cost-routing policies (read view shipped in 12O-2s). Gated
 * to `routing.read` by the shell RouteGuard (ADR-0017); the API enforces the
 * same server-side and auto-scopes to the tenant's own policies. Declarative only.
 */
export default function LcrPage() {
  return <LcrView />;
}
