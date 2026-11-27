/**
 * Shared BillingAccount fixture values that satisfy the S5 format CHECKs
 * (migration 20261128150000; owner decisions O3/O5):
 *   accountNumber            ^BA-[0-9]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$
 *   provisioningKey          ^[A-Za-z0-9._:-]{16,128}$
 *   provisioningFingerprint  ^v1:[0-9a-f]{64}$
 *
 * Fixture rows are inserted directly by the table owner (telvyn_migrator) with
 * provisionedByUserId NULL, so the provisioning completeness trigger does not
 * apply to them; only the format CHECKs do.
 */
import { createHash } from "node:crypto";
import { generateAccountNumberSuffix } from "../src/billing/billing-account-provisioning.contract";

/** A fresh, format-valid account number (random 12-character suffix). */
export function testAccountNumber(year = new Date().getUTCFullYear()): string {
  return `BA-${year}-${generateAccountNumberSuffix()}`;
}

/** Turns any unique fixture token into a format-valid idempotency key (>= 16 chars). */
export function testProvisioningKey(token: string): string {
  const cleaned = token.replace(/[^A-Za-z0-9._:-]/g, "-");
  return cleaned.length >= 16 ? cleaned.slice(0, 128) : cleaned.padEnd(16, "0");
}

/** A format-valid v1 fingerprint derived from a seed (distinct seeds → distinct values). */
export function testFingerprint(seed = "fixture"): string {
  return `v1:${createHash("sha256").update(seed).digest("hex")}`;
}
