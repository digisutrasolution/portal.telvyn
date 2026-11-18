"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, CornerDownLeft } from "lucide-react";
import { paletteMatch } from "@/lib/palette-filter";
import { useShell } from "./shell-provider";
import { useVisibleNavItems } from "./use-visible-nav";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

/**
 * Global command palette (⌘K / Ctrl+K): navigation + theme actions, with
 * E.164-aware matching ready for number search when the DID module (Phase 9)
 * plugs its data source in.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const { setTheme } = useTheme();
  const navItems = useVisibleNavItems();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  const run = (fn: () => void) => {
    setPaletteOpen(false);
    fn();
  };

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent
        hideClose
        className="top-[20%] w-[min(560px,92vw)] -translate-y-0 p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command filter={paletteMatch} label="Command palette">
          <CommandInput placeholder="Search numbers, pages, actions…" autoFocus />
          <CommandList>
            <CommandEmpty>No results. Number search connects with the DID module (Phase 9).</CommandEmpty>
            <CommandGroup heading="Go to">
              {navItems.map((item) => (
                <CommandItem key={item.href} value={`go ${item.label}`} onSelect={() => run(() => router.push(item.href))}>
                  <item.icon aria-hidden strokeWidth={1.5} />
                  {item.label}
                  <CornerDownLeft aria-hidden className="ml-auto size-3.5" strokeWidth={1.5} />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Theme">
              <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
                <Sun aria-hidden strokeWidth={1.5} />
                Light theme
              </CommandItem>
              <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
                <Moon aria-hidden strokeWidth={1.5} />
                Dark theme
              </CommandItem>
              <CommandItem value="theme system" onSelect={() => run(() => setTheme("system"))}>
                <Monitor aria-hidden strokeWidth={1.5} />
                System theme
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[11px] text-muted">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
            <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
