import type { Metadata } from "next";
import { RegionsView } from "@/components/noc/regions-view";

export const metadata: Metadata = { title: "Regions" };

export default function RegionsPage() {
  return <RegionsView />;
}
