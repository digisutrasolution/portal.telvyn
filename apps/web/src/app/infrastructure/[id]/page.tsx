import type { Metadata } from "next";
import { EngineDetailView } from "@/components/noc/engine-detail-view";

export const metadata: Metadata = { title: "Engine" };

/**
 * NOC — single engine detail (read-only). Platform + telecom.read gated by the
 * shell RouteGuard (the /infrastructure prefix); the API enforces the same.
 */
export default async function EngineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EngineDetailView engineId={id} />;
}
