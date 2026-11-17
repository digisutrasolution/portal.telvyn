import type { Problem } from "@/lib/contracts";

/** RFC 7807 problem body returned by the API on any non-2xx response. */
export type ApiProblem = Problem;

/**
 * Thrown for every non-2xx API response. Carries the parsed problem+json body
 * when the server sent one, otherwise a synthesized problem from the status.
 *
 * NOTE: request cancellation and timeouts are NOT ApiErrors — they surface as
 * the standard `DOMException` with name `"AbortError"` / `"TimeoutError"`, so
 * callers can tell "the server said no" from "we gave up waiting".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.title || `HTTP ${problem.status}`);
    this.name = "ApiError";
    this.status = problem.status;
    this.problem = problem;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
