"use client";

import { Globe2, ChevronsUpDown } from "lucide-react";
import { SHELL_CONFIG } from "@/lib/shell-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/** Region context switcher — regions activate per the market rollout (TELECOM.md). */
export function RegionSelector() {
  const { regions, activeRegionId } = SHELL_CONFIG;
  const active = regions.find((r) => r.id === activeRegionId) ?? regions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2.5">
          <Globe2 aria-hidden strokeWidth={1.5} />
          <span className="font-data hidden text-[12px] md:inline">{active.label}</span>
          <ChevronsUpDown aria-hidden className="size-3.5 text-muted" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Region</DropdownMenuLabel>
        {regions.map((region) => (
          <DropdownMenuCheckboxItem key={region.id} checked={region.id === active.id}>
            {region.label}
            {region.primary && <span className="ml-auto text-[11px] text-muted">primary</span>}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Additional regions activate with market rollout</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
