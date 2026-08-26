import type { Metadata } from "next";
import { Hash } from "lucide-react";
import { ModuleGate } from "@/components/shell/module-gate";

export const metadata: Metadata = { title: "Numbers" };

export default function NumbersPage() {
  return (
    <ModuleGate
      icon={Hash}
      title="Numbers"
      phase={9}
      description="DID inventory — search, order, assign, and release numbers. Gated on the carrier/DID-supply decision and the telecom foundation (Phase 8)."
    />
  );
}
