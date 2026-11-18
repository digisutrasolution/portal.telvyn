"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Engines", href: "/infrastructure" },
  { label: "Nodes", href: "/infrastructure/nodes" },
  { label: "Regions", href: "/infrastructure/regions" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/infrastructure") {
    // Engines tab owns the section root and engine detail, but not the siblings.
    return (
      pathname === "/infrastructure" ||
      (pathname.startsWith("/infrastructure/") &&
        !pathname.startsWith("/infrastructure/nodes") &&
        !pathname.startsWith("/infrastructure/regions"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sub-navigation for the NOC infrastructure section (ADR-0018). */
export function InfraTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Infrastructure" className="mb-5 flex gap-1 border-b border-line">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium",
              active
                ? "border-accent text-accent"
                : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
