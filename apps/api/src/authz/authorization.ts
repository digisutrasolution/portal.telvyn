import { ALL_PERMISSION_KEYS, WILDCARD_EXCLUDED_KEYS } from "./permission-catalog";

/**
 * Pure authorization logic — the core of RBAC, deny-by-default.
 * Grants may be exact ("did.read"), resource wildcards ("did.*"), or global
 * ("*"). A required permission is satisfied iff some grant matches it.
 *
 * Wildcard exclusion (ADR-0022 Amendment 5 BA-08, Phase 13-2B S1): a permission
 * flagged `wildcardExcluded` in the catalog (high-risk financial authority) is
 * NEVER covered by `*` or `x.*` — only an exact, explicit grant satisfies it.
 * The excluded set defaults to the catalog's; tests may inject their own.
 */

/** Does a single grant cover a required permission key? */
export function grantCovers(
  grant: string,
  required: string,
  excluded: ReadonlySet<string> = WILDCARD_EXCLUDED_KEYS,
): boolean {
  if (grant === required) return true;
  if (excluded.has(required)) return false; // wildcard-excluded: exact grant only
  if (grant === "*") return true;
  if (grant.endsWith(".*")) {
    const prefix = grant.slice(0, -1); // "did." (keep the dot)
    return required.startsWith(prefix);
  }
  return false;
}

/** Does a set of grants satisfy ALL required permissions? Empty grants → deny. */
export function isAuthorized(
  grants: Iterable<string>,
  required: string[],
  excluded: ReadonlySet<string> = WILDCARD_EXCLUDED_KEYS,
): boolean {
  const grantList = [...grants];
  if (required.length === 0) return true;
  return required.every((req) => grantList.some((g) => grantCovers(g, req, excluded)));
}

/**
 * Expand a role's grant list (may contain wildcards) into concrete permission
 * keys. Wildcards never expand to a wildcard-excluded key; an explicit grant of
 * one is kept as-is (assignment policy is enforced separately — see
 * `assertNoWildcardExcludedAssignment`).
 */
export function expandGrants(
  grants: string[],
  allKeys: readonly string[] = ALL_PERMISSION_KEYS,
  excluded: ReadonlySet<string> = WILDCARD_EXCLUDED_KEYS,
): string[] {
  const out = new Set<string>();
  for (const g of grants) {
    if (g === "*") {
      for (const k of allKeys) if (!excluded.has(k)) out.add(k);
    } else if (g.endsWith(".*")) {
      const prefix = g.slice(0, -1);
      for (const k of allKeys) if (k.startsWith(prefix) && !excluded.has(k)) out.add(k);
    } else {
      out.add(g);
    }
  }
  return [...out];
}

/**
 * MFA-for-finance (BA-08): a wildcard-excluded (high-risk financial) permission
 * is only EFFECTIVE for a user with MFA enabled. Without MFA such keys are
 * dropped from the effective set — fail closed, never an error that leaks state.
 */
export function effectivePermissions(
  keys: Iterable<string>,
  mfaEnabled: boolean,
  excluded: ReadonlySet<string> = WILDCARD_EXCLUDED_KEYS,
): Set<string> {
  const out = new Set<string>();
  for (const k of keys) if (mfaEnabled || !excluded.has(k)) out.add(k);
  return out;
}

/** Raised when a role/assignment would confer a wildcard-excluded permission. */
export class WildcardExcludedAssignmentError extends Error {
  constructor(readonly keys: string[]) {
    super(`Assignment of high-risk financial permission(s) is not available: ${keys.join(", ")}`);
    this.name = "WildcardExcludedAssignmentError";
  }
}

/**
 * Assignment policy for S1 (owner decision G4): conferring ANY wildcard-excluded
 * permission through a custom role or a membership role assignment FAILS CLOSED.
 * The governed path (step-up + no self-assignment + same-transaction financial
 * audit) is opened by a later slice (S2/S5), never implicitly.
 */
export function assertNoWildcardExcludedAssignment(
  keys: Iterable<string>,
  excluded: ReadonlySet<string> = WILDCARD_EXCLUDED_KEYS,
): void {
  const hits = [...new Set([...keys].filter((k) => excluded.has(k)))];
  if (hits.length) throw new WildcardExcludedAssignmentError(hits.sort());
}
