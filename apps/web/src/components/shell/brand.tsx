import Link from "next/link";
import { SHELL_CONFIG } from "@/lib/shell-config";
import { cn } from "@/lib/utils";

/** Telvyn wordmark lockup (design system v0.1 provisional identity). */
export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 rounded-md px-1 py-1", collapsed && "justify-center")}
      aria-label={`${SHELL_CONFIG.product} ${SHELL_CONFIG.productSuffix} — home`}
    >
      <span
        aria-hidden
        className="font-display grid size-8 shrink-0 place-items-center rounded-md bg-ink text-[16px] font-bold text-canvas"
      >
        T
      </span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="font-display block text-[15px] font-semibold tracking-tight">
            {SHELL_CONFIG.product}
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            {SHELL_CONFIG.productSuffix}
          </span>
        </span>
      )}
    </Link>
  );
}
