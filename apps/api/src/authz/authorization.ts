import { ALL_PERMISSION_KEYS } from "./permission-catalog";

/**
 * Pure authorization logic — the core of RBAC, deny-by-default.
 * Grants may be exact ("did.read"), resource wildcards ("did.*"), or global
 * ("*"). A required permission is satisfied iff some grant matches it.
 */

/** Does a single grant cover a required permission key? */
export function grantCovers(grant: string, required: string): boolean {
  if (grant === "*") return true;
  if (grant === required) return true;
  if (grant.endsWith(".*")) {
    const prefix = grant.slice(0, -1); // "did." (keep the dot)
    return required.startsWith(prefix);
  }
  return false;
}

/** Does a set of grants satisfy ALL required permissions? Empty grants → deny. */
export function isAuthorized(grants: Iterable<string>, required: string[]): boolean {
  const grantList = [...grants];
  if (required.length === 0) return true;
  return required.every((req) => grantList.some((g) => grantCovers(g, req)));
}

/** Expand a role's grant list (may contain wildcards) into concrete permission keys. */
export function expandGrants(grants: string[]): string[] {
  const out = new Set<string>();
  for (const g of grants) {
    if (g === "*") {
      for (const k of ALL_PERMISSION_KEYS) out.add(k);
    } else if (g.endsWith(".*")) {
      const prefix = g.slice(0, -1);
      for (const k of ALL_PERMISSION_KEYS) if (k.startsWith(prefix)) out.add(k);
    } else {
      out.add(g);
    }
  }
  return [...out];
}
