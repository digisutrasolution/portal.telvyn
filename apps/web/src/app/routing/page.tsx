import type { Metadata } from "next";
import { RoutingView } from "@/components/routing/routing-view";

export const metadata: Metadata = { title: "Routing" };

/**
 * Routing — tenant routing profiles (read view shipped in 12O-2r). Gated to
 * `routing.read` by the shell RouteGuard (ADR-0017); the API enforces the same
 * server-side and auto-scopes to the tenant's own profiles. Declarative only.
 */
export default function RoutingPage() {
  return <RoutingView />;
}
