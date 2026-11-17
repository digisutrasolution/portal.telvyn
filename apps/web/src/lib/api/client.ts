import { getAccessToken } from "./token-store";
import { ApiError, type ApiProblem } from "./problem";

/**
 * Centralized, typed API client — the single egress point to the Telvyn API.
 *
 * - Base URL from NEXT_PUBLIC_API_URL (default: the local API on :3311).
 * - Attaches the in-memory bearer access token (opt out with `auth: false`).
 * - Sends credentials so the httpOnly refresh cookie flows to /v1/auth later.
 * - Per-request timeout + caller cancellation, both via one AbortSignal.
 * - Non-2xx -> throws ApiError carrying the RFC 7807 problem body.
 * - NO automatic retry. A failed mutation is never silently replayed (double
 *   POST / toll-fraud risk); refresh-driven retry of idempotent reads is a
 *   later, explicit concern, not a hidden default here.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3311").replace(/\/+$/, "");

const DEFAULT_TIMEOUT_MS = 15_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  /** Request body; JSON-serialized automatically when present. */
  body?: unknown;
  /** Caller cancellation; combined with the internal timeout. */
  signal?: AbortSignal;
  /** Per-request timeout in ms (default 15s). */
  timeoutMs?: number;
  /** Attach the bearer access token (default true). */
  auth?: boolean;
}

async function toProblem(res: Response): Promise<ApiProblem> {
  try {
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      const body = (await res.json()) as Partial<ApiProblem> | null;
      if (body && typeof body.status === "number" && typeof body.title === "string") {
        return body as ApiProblem;
      }
    }
  } catch {
    // Malformed / empty error body — fall through to a synthesized problem.
  }
  return { title: res.statusText || `HTTP ${res.status}`, status: res.status };
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // One controller fans in both the caller's signal and our timeout.
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      signal: controller.signal,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener("abort", onCallerAbort);
  }

  if (!res.ok) throw new ApiError(await toProblem(res));
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

/** Thin typed verbs over `request`. */
export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};
