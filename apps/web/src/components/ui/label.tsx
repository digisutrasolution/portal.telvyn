import * as React from "react";
import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

/** Form label, design-system v0.1 tokens. */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn("block text-[12px] font-medium text-ink-2", className)} {...props} />
));
Label.displayName = "Label";
