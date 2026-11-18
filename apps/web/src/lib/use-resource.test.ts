import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import { useResource } from "./use-resource";

describe("useResource", () => {
  it("loads data and clears loading", async () => {
    const { result } = renderHook(() => useResource(async () => [1, 2, 3]));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the RFC 7807 title on an ApiError", async () => {
    const { result } = renderHook(() =>
      useResource(async () => {
        throw new ApiError({ title: "Forbidden", status: 403 });
      }),
    );
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("falls back to a generic message for a non-API error", async () => {
    const { result } = renderHook(() =>
      useResource(async () => {
        throw new Error("boom");
      }),
    );
    await waitFor(() => expect(result.current.error).toMatch(/couldn't load/i));
  });

  it("reload() re-runs the fetcher", async () => {
    const fetcher = vi.fn(async () => "ok");
    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    result.current.reload();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
