import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { ModuleGate } from "@/components/shell/module-gate";

export const metadata: Metadata = { title: "Porting" };

export default function PortingPage() {
  return (
    <ModuleGate
      icon={ArrowLeftRight}
      title="Porting desk"
      phase={9}
      description="Port-in and port-out workflows with LOA handling and anti-hijack controls. Arrives with the DID module."
    />
  );
}
