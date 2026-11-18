"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItemForPath } from "@/lib/nav";
import { SHELL_CONFIG } from "@/lib/shell-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useVisibleNavItems } from "./use-visible-nav";

/**
 * Primary navigation list — shared by the desktop sidebar and mobile sheet.
 * Queue badges render only when the telemetry seam provides counts (Phase 16).
 */
export function NavList({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = navItemForPath(pathname);
  const queues = SHELL_CONFIG.telemetry.queues;
  const items = useVisibleNavItems();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
      {items.map((item) => {
        const isActive = active?.href === item.href;
        const count = item.queueKey && queues ? queues[item.queueKey] : undefined;
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink",
              isActive && "bg-accent-soft font-semibold text-accent hover:bg-accent-soft hover:text-accent",
              collapsed && "justify-center px-0",
            )}
          >
            <item.icon aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {!collapsed && count !== undefined && (
              <span className="font-data ml-auto rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold text-warn">
                {count}
              </span>
            )}
          </Link>
        );
        return collapsed ? (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}
