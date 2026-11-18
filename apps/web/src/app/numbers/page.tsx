import type { Metadata } from "next";
import { NumbersView } from "@/components/numbers/numbers-view";

export const metadata: Metadata = { title: "Numbers" };

/**
 * Numbers — DID inventory (read view shipped in 12O-2q). Gated to `did.read` by
 * the shell RouteGuard (ADR-0017); the API enforces the same server-side and
 * auto-scopes to the tenant's own numbers (never the platform inventory pool).
 */
export default function NumbersPage() {
  return <NumbersView />;
}
