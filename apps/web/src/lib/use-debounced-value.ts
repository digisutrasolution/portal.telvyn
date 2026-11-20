import * as React from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` has
 * elapsed without a further change. Used to throttle filter/search queries so a
 * fetch fires once the user pauses typing, not on every keystroke. The initial
 * value is returned immediately (no first-render delay), and a pending update is
 * cancelled when the value changes again or the component unmounts.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
