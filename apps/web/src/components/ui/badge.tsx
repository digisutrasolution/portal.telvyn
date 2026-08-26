import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-semibold uppercase tracking-wide leading-none",
  {
    variants: {
      tone: {
        ok: "bg-ok-soft text-ok",
        info: "bg-info-soft text-info",
        warn: "bg-warn-soft text-warn",
        danger: "bg-danger-soft text-danger",
        frozen: "bg-frozen-soft text-frozen",
        neutral: "bg-neutral-soft text-neutral-status",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
