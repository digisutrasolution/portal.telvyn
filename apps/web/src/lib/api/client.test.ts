import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, request } from "./client";
import { ApiError, isApiError } from "./problem";
import { clearAccessToken, setAccessToken } from "./token-store";

const originalFetch = global.fetch;

function mockFetchOnce(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl as never);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** A fetch that never resolves until its signal aborts, then rejects with the reason. */
function hangingFetch() {
  return mockFetchOnce(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
}

beforeEach(() => clearAccessToken());
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("parses a JSON success body", async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(request<{ ok: boolean }>("/v1/x")).resolves.toEqual({ ok: true });
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetchOnce(() => new Response(null, { status: 204 }));
    await expect(request("/v1/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("attaches the bearer token when one is set", async () => {
    setAccessToken("tok-123");
    const fn = mockFetchOnce(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await request("/v1/me/context");
    const init = fn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    expect(init.credentials).toBe("include");
  });

  it("omits the bearer token when auth:false, even if one is set", async () => {
    setAccessToken("tok-123");
    const fn = mockFetchOnce(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await request("/v1/public", { auth: false });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("serializes a JSON body and sets Content-Type", async () => {
    const fn = mockFetchOnce(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await api.post("/v1/things", { name: "a" });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "a" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("throws a typed ApiError carrying the problem+json body on non-2xx", async () => {
    mockFetchOnce(
      () =>
        new Response(JSON.stringify({ title: "Insufficient permissions", status: 403, detail: "need role.manage" }), {
          status: 403,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    const err = await request("/v1/x").catch((e) => e);
    expect(isApiError(err)).toBe(true);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).problem.title).toBe("Insufficient permissions");
    expect((err as ApiError).problem.detail).toBe("need role.manage");
  });

  it("synthesizes a problem when the error body is not problem+json", async () => {
    mockFetchOnce(() => new Response("gateway boom", { status: 502, headers: { "content-type": "text/plain" } }));
    const err = (await request("/v1/x").catch((e) => e)) as ApiError;
    expect(isApiError(err)).toBe(true);
    expect(err.status).toBe(502);
  });

  it("times out via the internal AbortController (TimeoutError), and never retries", async () => {
    const fn = hangingFetch();
    const err = (await request("/v1/slow", { timeoutMs: 10 }).catch((e) => e)) as DOMException;
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("TimeoutError");
    expect(fn).toHaveBeenCalledTimes(1); // no auto-retry
  });

  it("propagates caller cancellation", async () => {
    hangingFetch();
    const ac = new AbortController();
    const p = request("/v1/slow", { signal: ac.signal, timeoutMs: 10_000 }).catch((e) => e);
    ac.abort();
    const err = (await p) as DOMException;
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("AbortError");
  });
});
