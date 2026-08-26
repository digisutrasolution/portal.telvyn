/**
 * E.164-aware command-palette matching (design system §10): a query containing
 * digits matches items whose digit sequence contains it, regardless of "+",
 * spaces, or dashes; otherwise falls back to case-insensitive substring.
 * Pure — unit tested. Returns 1 (match) or 0 (no match) per cmdk contract.
 */
export function paletteMatch(value: string, search: string): number {
  const q = search.trim();
  if (!q) return 1;
  const qDigits = q.replace(/[\s()+-]/g, "");
  if (/^\d+$/.test(qDigits) && qDigits.length > 0) {
    const vDigits = value.replace(/\D/g, "");
    if (vDigits.includes(qDigits)) return 1;
  }
  return value.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
}
