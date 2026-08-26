"use client";

import { Building2, ChevronsUpDown } from "lucide-react";
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

/**
 * Tenant context switcher. Single platform tenant until the tenant system
 * ships (Phase 3) — the menu states that honestly rather than hiding.
 */
export function TenantSelector() {
  const { tenants, activeTenantId } = SHELL_CONFIG;
  const active = tenants.find((t) => t.id === activeTenantId) ?? tenants[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-48 gap-2 px-2.5">
          <Building2 aria-hidden strokeWidth={1.5} />
          <span className="hidden truncate sm:inline">{active.name}</span>
          <ChevronsUpDown aria-hidden className="size-3.5 text-muted" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>Tenant</DropdownMenuLabel>
        {tenants.map((tenant) => (
          <DropdownMenuCheckboxItem key={tenant.id} checked={tenant.id === active.id}>
            {tenant.name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Multi-tenant switching ships with the tenant system (Phase 3)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
