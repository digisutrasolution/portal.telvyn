import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Semantic status language (design system §4/§10) — dot + label, never color-only. */
const statusVariants = cva("inline-flex items-center gap-1.5 text-[12px] font-medium", {
  variants: {
    tone: {
      ok: "text-ok",
      info: "text-info",
      warn: "text-warn",
      danger: "text-danger",
      frozen: "text-frozen",
      neutral: "text-neutral-status",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface StatusProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusVariants> {
  label: string;
}

export function Status({ tone, label, className, ...props }: StatusProps) {
  return (
    <span className={cn(statusVariants({ tone }), className)} {...props}>
      <span aria-hidden className="size-2 rounded-full bg-current" />
      {label}
    </span>
  );
}
