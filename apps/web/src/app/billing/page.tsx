import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { ModuleGate } from "@/components/shell/module-gate";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <ModuleGate
      icon={Wallet}
      title="Billing"
      phase={13}
      description="Ledger-backed balances, charges, and statements. Gated on the billing-model decision (prepaid wallet vs invoicing)."
    />
  );
}
