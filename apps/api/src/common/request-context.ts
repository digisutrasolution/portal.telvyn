import type { Request } from "express";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Extract audit context. Trusts direct socket data; proxy headers are a deploy-time decision (Phase 20). */
export function requestContext(req: Request): RequestContext {
  return {
    ipAddress: req.socket.remoteAddress ?? null,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 512) : null,
  };
}

/** Compact human device label from a user agent — display only, never security. */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os = /Windows NT/.test(userAgent)
    ? "Windows"
    : /Mac OS X/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  if (!os && !browser) return null;
  return [browser, os].filter(Boolean).join(" · ");
}
