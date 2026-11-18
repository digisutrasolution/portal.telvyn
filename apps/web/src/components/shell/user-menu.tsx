"use client";

import Link from "next/link";
import { CircleUserRound, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/lib/session/session-context";

/**
 * Account menu. Reads the live session (the shell renders only for
 * authenticated sessions) and offers sign-out, which revokes the server
 * session and drops back to the sign-in screen.
 */
export function UserMenu() {
  const { context, signOut } = useSession();
  const primaryRole = context?.roles[0]?.name;
  const tenantType = context ? context.tenantType.charAt(0) + context.tenantType.slice(1).toLowerCase() : null;

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
        <div className="px-2.5 pb-1.5 text-[12px]" title={context?.userId}>
          <span className="block text-ink">{primaryRole ?? "Signed in"}</span>
          {tenantType && <span className="block text-muted">{tenantType} workspace</span>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <ShieldCheck aria-hidden strokeWidth={1.5} />
            Account &amp; security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden strokeWidth={1.5} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
