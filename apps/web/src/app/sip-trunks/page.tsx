import type { Metadata } from "next";
import { SipTrunksView } from "@/components/sip-trunks/sip-trunks-view";

export const metadata: Metadata = { title: "SIP trunks" };

/**
 * SIP trunks — tenant connectivity config (Phase 11 surface; read view shipped
 * in 12O-2p). Gated to `sip_trunk.read` by the shell RouteGuard (ADR-0017); the
 * API enforces the same server-side and auto-scopes to the tenant's own trunks.
 */
export default function SipTrunksPage() {
  return <SipTrunksView />;
}
