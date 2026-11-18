import * as React from "react";
import { InfraTabs } from "@/components/noc/infra-tabs";

/** NOC infrastructure section: sub-nav (Engines / Nodes / Regions) + the page. */
export default function InfrastructureLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <InfraTabs />
      {children}
    </div>
  );
}
