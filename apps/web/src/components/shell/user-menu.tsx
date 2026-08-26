"use client";

import { CircleUserRound, LogIn } from "lucide-react";
import { SHELL_CONFIG } from "@/lib/shell-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Account menu. Session comes from the auth seam — null until authentication
 * ships (Phase 2), in which state the menu says exactly that.
 */
export function UserMenu() {
  const { user } = SHELL_CONFIG.session;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account">
              <CircleUserRound aria-hidden strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Account</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        {user === null && (
          <>
            <div className="px-2.5 py-1.5 text-[12px] text-muted">
              Not signed in — authentication ships with Phase 2 (MFA, sessions, RBAC).
            </div>
            <DropdownMenuItem disabled>
              <LogIn aria-hidden strokeWidth={1.5} />
              Sign in (Phase 2)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
