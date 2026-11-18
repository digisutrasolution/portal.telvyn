"use client";

import * as React from "react";
import { isApiError } from "@/lib/api/problem";

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-run the fetch. */
  reload: () => void;
}

/**
 * Read-only data loader over the typed API client (ADR-0018). Fetches on mount
 * and on `reload()`, aborts on unmount, and surfaces a human-readable error
 * (the RFC 7807 title when the API refused). The latest `fetcher` is captured by
 * ref so an inline closure never causes a refetch loop; pass a new value to
 * `reload()` to refetch. For parameterized reads, call `reload()` when inputs
 * change (or key the component).
 */
export function useResource<T>(fetcher: (signal: AbortSignal) => Promise<T>): ResourceState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    fetcherRef.current(ac.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(isApiError(err) ? err.problem.title : "Couldn't load data. Please try again.");
        setLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
