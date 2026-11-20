import type { Metadata } from "next";
import { MembersView } from "@/components/admin/members-view";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return <MembersView />;
}
