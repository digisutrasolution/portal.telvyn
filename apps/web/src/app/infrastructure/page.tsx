import type { Metadata } from "next";
import { EnginesView } from "@/components/noc/engines-view";

export const metadata: Metadata = { title: "Infrastructure" };

/**
 * NOC — platform telecom infrastructure. Read-only. The route is gated to
 * PLATFORM sessions with `telecom.read` by the shell RouteGuard (ADR-0018); the
 * API enforces the same server-side.
 */
export default function InfrastructurePage() {
  return <EnginesView />;
}
