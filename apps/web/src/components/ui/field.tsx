import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * Labelled form field: a <Label> bound to its control by `id`, the control
 * itself (passed as children), and an optional error or hint message.
 *
 * The control MUST use the same `id` and, when `error` is set, carry
 * `aria-invalid` and `aria-describedby={`${id}-error`}` so assistive tech
 * announces the error. `errorId(id)` returns that id for the caller.
 */
export function errorId(id: string): string {
  return `${id}-error`;
}

export function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={errorId(id)} role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
