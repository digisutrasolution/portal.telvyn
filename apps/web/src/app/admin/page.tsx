import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { ModuleGate } from "@/components/shell/module-gate";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <ModuleGate
      icon={Settings}
      title="Administration"
      phase={6}
      description="Users, roles, tenants, and platform settings — arrives after authentication (Phase 2), the tenant system (Phase 3), and RBAC (Phase 4)."
    />
  );
}
