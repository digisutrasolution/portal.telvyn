import type { Metadata } from "next";
import { CarriersView } from "@/components/carriers/carriers-view";

export const metadata: Metadata = { title: "Carriers" };

/**
 * Carriers — tenant connectivity (Phase 10 surface; read view shipped in
 * 12O-2o). Gated to `carrier.read` by the shell RouteGuard (ADR-0017); the API
 * enforces the same server-side and scopes results to own + system carriers.
 */
export default function CarriersPage() {
  return <CarriersView />;
}
