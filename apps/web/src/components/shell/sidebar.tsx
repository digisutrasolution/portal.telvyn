"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Brand } from "./brand";
import { NavList } from "./nav-list";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "telvyn.sidebar.collapsed";

/** Desktop navigation rail — collapsible to an icon rail (state persisted per viewer). */
export function Sidebar() {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable — default expanded */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface-2 lg:flex",
        collapsed ? "w-16" : "w-52",
      )}
    >
      <div className={cn("px-3 pb-2 pt-3", collapsed && "px-2")}>
        <Brand collapsed={collapsed} />
      </div>
      <Separator className="mb-2" />
      <NavList collapsed={collapsed} />
      <div className={cn("mt-auto p-2", collapsed && "flex justify-center")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden strokeWidth={1.5} />
              ) : (
                <PanelLeftClose aria-hidden strokeWidth={1.5} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"} sidebar</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
