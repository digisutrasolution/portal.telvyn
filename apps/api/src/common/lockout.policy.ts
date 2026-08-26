/**
 * Progressive account-lockout policy (brute-force protection, SECURITY.md
 * baseline). Pure — unit tested. Returns lock duration in seconds for a given
 * consecutive-failure count, or 0 when no lock applies.
 */
export function lockoutSeconds(failedLogins: number): number {
  if (failedLogins < 5) return 0;
  if (failedLogins < 8) return 60; // 5–7 fails: 1 minute
  if (failedLogins < 10) return 300; // 8–9 fails: 5 minutes
  if (failedLogins < 15) return 900; // 10–14 fails: 15 minutes
  return 3600; // 15+: 1 hour cap
}
