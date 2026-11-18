import { isApiError } from "@/lib/api/problem";

/** Human-readable message for an auth error — the RFC 7807 title/detail, or a generic fallback. */
export function messageFor(err: unknown): string {
  if (isApiError(err)) {
    return err.problem.detail ? `${err.problem.title} — ${err.problem.detail}` : err.problem.title;
  }
  return "Something went wrong. Please try again.";
}
