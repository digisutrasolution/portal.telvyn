"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { breadcrumbsForPath } from "@/lib/breadcrumbs";
import { cn } from "@/lib/utils";

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = breadcrumbsForPath(pathname);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, i) => (
          <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted" strokeWidth={1.5} />}
            {crumb.current ? (
              <span aria-current="page" className="truncate font-semibold text-ink">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className={cn("truncate text-muted hover:text-ink")}>
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
