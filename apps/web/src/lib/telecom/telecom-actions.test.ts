import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from "@/lib/api/client";
import { listEngines } from "./telecom-actions";

afterEach(() => vi.clearAllMocks());

describe("telecom-actions", () => {
  it("listEngines GETs the platform engines endpoint with the bearer token", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    await listEngines();
    expect(api.get).toHaveBeenCalledWith("/v1/telecom/engines", { signal: undefined });
  });

  it("passes an abort signal through", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    const signal = new AbortController().signal;
    await listEngines(signal);
    expect(api.get).toHaveBeenCalledWith("/v1/telecom/engines", { signal });
  });
});
