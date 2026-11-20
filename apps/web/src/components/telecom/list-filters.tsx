"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** One select control in a filter bar. `value === ""` means "All" (no filter). */
export interface FilterSelectConfig {
  /** Stable key + query-param name. */
  name: string;
  /** Accessible name (these controls carry no visible label). */
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  /** Label for the empty/"no filter" option. Defaults to "All". */
  allLabel?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function FilterSelect({ label, value, options, allLabel = "All", onChange, disabled }: FilterSelectConfig) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink",
        "outline-none disabled:cursor-not-allowed disabled:opacity-45",
      )}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Reusable read-screen filter bar (Phase 12O-2y): an optional debounce-ready
 * search box plus any number of select controls, with a Clear action shown when
 * a filter is active. Purely presentational and controlled — the parent owns the
 * filter state, maps it to the screen's already-contracted list query params, and
 * debounces the search value (via `useDebouncedValue`) before fetching. This sets
 * the filter pattern for the other telecom read screens.
 */
export function ListFilters({
  search,
  selects = [],
  onClear,
  canClear = false,
  disabled = false,
}: {
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder?: string };
  selects?: FilterSelectConfig[];
  onClear?: () => void;
  canClear?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="search" className="mb-3 flex flex-wrap items-center gap-2">
      {search && (
        <Input
          type="search"
          aria-label={search.label}
          placeholder={search.placeholder ?? "Search"}
          value={search.value}
          disabled={disabled}
          onChange={(e) => search.onChange(e.target.value)}
          className="w-full max-w-[220px] sm:w-56"
        />
      )}
      {selects.map((s) => (
        <FilterSelect key={s.name} disabled={disabled} {...s} />
      ))}
      {canClear && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
