import type { Metadata } from "next";
import { ListOrdered } from "lucide-react";
import { ModuleGate } from "@/components/shell/module-gate";

export const metadata: Metadata = { title: "CDRs" };

export default function CdrsPage() {
  return (
    <ModuleGate
      icon={ListOrdered}
      title="Call detail records"
      phase={14}
      description="Filterable, exportable CDR views over partitioned storage. Gated on the CDR-source decision."
    />
  );
}
