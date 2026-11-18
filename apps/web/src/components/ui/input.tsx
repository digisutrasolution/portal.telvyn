import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Text input, skinned to design-system v0.1 tokens. Focus ring is the global
 * `:focus-visible` treatment (globals.css); this only sets the resting and
 * invalid borders. Pair with <Field> / <Label> for an accessible label.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-8 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-ink",
        "placeholder:text-muted outline-none disabled:cursor-not-allowed disabled:opacity-45",
        "aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
