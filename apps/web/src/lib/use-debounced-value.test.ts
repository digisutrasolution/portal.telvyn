import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300));
    expect(result.current).toBe("a");
  });

  it("updates only after the delay has fully elapsed", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } });
    rerender({ v: "ab" });
    expect(result.current).toBe("a"); // still the old value
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe("a"); // one tick short
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("ab"); // delay reached
  });

  it("debounces rapid changes down to the latest value", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } });
    rerender({ v: "ab" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "abc" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "abcd" });
    expect(result.current).toBe("a"); // no window ever completed
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("abcd"); // only the final value lands
  });
});
