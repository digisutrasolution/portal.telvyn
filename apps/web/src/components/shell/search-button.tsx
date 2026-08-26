"use client";

import { Search } from "lucide-react";
import { useShell } from "./shell-provider";
import { Kbd } from "@/components/ui/kbd";

/** Global search affordance — opens the command palette. */
export function SearchButton() {
  const { setPaletteOpen } = useShell();

  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-label="Search (Ctrl+K)"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-8 w-full max-w-72 cursor-pointer items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] text-muted hover:bg-surface-2"
    >
      <Search aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="hidden truncate sm:inline">Search numbers, pages, actions…</span>
      <span className="ml-auto hidden items-center gap-1 md:flex">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
