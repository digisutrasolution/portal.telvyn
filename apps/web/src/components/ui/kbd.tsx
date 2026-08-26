import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "font-data rounded-sm border border-line-strong border-b-2 bg-surface-2 px-1.5 py-px text-[11px] font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}
