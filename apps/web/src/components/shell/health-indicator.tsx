"use client";

import { SHELL_CONFIG } from "@/lib/shell-config";
import { Status } from "@/components/ui/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * System health rollup. Honest by design: renders real telemetry when the
 * monitoring plane provides it (Phases 16/20); until then it says so instead
 * of faking green.
 */
export function HealthIndicator() {
  const health = SHELL_CONFIG.telemetry.health;

  if (!health) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="hidden cursor-default items-center rounded-md px-2 py-1.5 hover:bg-surface-2 md:inline-flex"
            aria-label="System health: no telemetry connected yet"
          >
            <Status tone="neutral" label="No telemetry" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Live system health appears here once the monitoring plane is connected (Phases 16/20).
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="hidden items-center rounded-md px-2 py-1.5 hover:bg-surface-2 md:inline-flex"
          aria-label={`System health: ${health.label}`}
        >
          <Status tone={health.tone} label={health.label} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        As of <span className="font-data">{health.asOf}</span>
      </TooltipContent>
    </Tooltip>
  );
}
