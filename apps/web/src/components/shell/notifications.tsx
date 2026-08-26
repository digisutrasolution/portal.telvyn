"use client";

import { Bell, Inbox } from "lucide-react";
import { SHELL_CONFIG } from "@/lib/shell-config";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Notification center. Async outcomes (order completed, port rejected, fraud
 * trips) land here as their modules ship; empty state is honest and teaches.
 */
export function Notifications() {
  const notifications = SHELL_CONFIG.telemetry.notifications;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Notifications (${notifications.length})`}>
              <Bell aria-hidden strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent aria-label="Notifications">
        <header className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Notifications</header>
        {notifications.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Inbox aria-hidden className="size-6 text-muted" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-ink-2">No notifications yet</p>
            <p className="text-[12px] text-muted">
              Provisioning, porting, and billing events will appear here as those modules come online.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
