import { createHash, randomInt } from "node:crypto";
import { Currency } from "@prisma/client";
import { z } from "zod";

/**
 * BillingAccount provisioning contract (Phase 13-2B S5; ADR-0022 Amendment 5
 * BA-03; owner decisions O3 account number, O5 idempotency). Pure values and
 * functions shared by the service, the financial audit schema and tests. The
 * database function billing.billing_account_provision re-checks every format.
 */

export const BILLING_ACCOUNT_PROVISION_OPERATION = "billing_account.provision";
export const BILLING_ACCOUNT_PROVISION_PERMISSION = "billing.account.provision";

// ---- O3: account number BA-YYYY-XXXXXXXXXXXX --------------------------------
/**
 * Unambiguous upper-case alphabet: digits 2-9 and letters without I, L, O, U
 * (no 0/O, 1/I/L confusion). 30 symbols; 12 symbols ≈ 58.9 bits of entropy.
 */
export const ACCOUNT_NUMBER_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ACCOUNT_NUMBER_SUFFIX_LENGTH = 12;
export const ACCOUNT_NUMBER_SUFFIX_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;
export const ACCOUNT_NUMBER_PATTERN = /^BA-[0-9]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;
/** Bounded collision handling: total attempts with fresh random suffixes. */
export const ACCOUNT_NUMBER_MAX_ATTEMPTS = 3;

/**
 * The random part of an account number, from the OS CSPRNG. `randomInt` is
 * uniform over [0, 30) (rejection sampling), so there is no modulo bias. The
 * "BA-YYYY-" prefix is added by the database from its own UTC clock, so the
 * year is the account's UTC creation year. No counter, no tenant data, no PII.
 */
export function generateAccountNumberSuffix(): string {
  let out = "";
  for (let i = 0; i < ACCOUNT_NUMBER_SUFFIX_LENGTH; i++) out += ACCOUNT_NUMBER_ALPHABET[randomInt(ACCOUNT_NUMBER_ALPHABET.length)];
  return out;
}

// ---- O5: idempotency ---------------------------------------------------------
/** 16–128 ASCII characters from [A-Za-z0-9-_.:] — no whitespace or control characters. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9\-_.:]{16,128}$/;
export const PROVISIONING_FINGERPRINT_VERSION = "v1";
export const PROVISIONING_FINGERPRINT_PATTERN = /^v1:[0-9a-f]{64}$/;

export function isValidIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && IDEMPOTENCY_KEY_PATTERN.test(v);
}

export interface ProvisioningFingerprintInput {
  actorUserId: string;
  actorTenantId: string;
  targetTenantId: string;
  currency: Currency;
  label: string;
  isDefault: boolean;
}

/**
 * Versioned canonical request fingerprint. The canonical form is a fixed-order
 * JSON array of [name, value] pairs, so it does not depend on object key order.
 * It binds the operation, the actor, the target tenant and every business
 * parameter; it deliberately EXCLUDES the step-up grant id, so a legitimate
 * retry with a fresh grant replays the original result (O5).
 */
export function provisioningFingerprint(i: ProvisioningFingerprintInput): string {
  const canonical = JSON.stringify([
    ["v", 1],
    ["operation", BILLING_ACCOUNT_PROVISION_OPERATION],
    ["actorUserId", i.actorUserId.toLowerCase()],
    ["actorTenantId", i.actorTenantId.toLowerCase()],
    ["targetTenantId", i.targetTenantId.toLowerCase()],
    ["currency", i.currency],
    ["mode", "PREPAID"],
    ["label", i.label],
    ["isDefault", i.isDefault],
  ]);
  return `${PROVISIONING_FINGERPRINT_VERSION}:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// ---- request / label -----------------------------------------------------------
/** Printable label: trimmed, 1–100 characters, no control characters. */
export const LabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "label must not contain control characters");

export const ProvisionBillingAccountDto = z
  .object({
    targetTenantId: z.string().uuid(),
    currency: z.nativeEnum(Currency),
    label: LabelSchema,
    isDefault: z.boolean().default(false),
    /** PREPAID only in S5; any other value is refused. */
    mode: z.literal("PREPAID").default("PREPAID"),
    /** A fresh single-use step-up grant for purpose billing_account.provision. */
    stepUpGrantId: z.string().uuid(),
  })
  .strict();
export type ProvisionBillingAccountInput = z.infer<typeof ProvisionBillingAccountDto>;

// ---- financial audit metadata (O6: strict, server-derived) ----------------------
export const ProvisionAuditAfterSchema = z
  .object({
    accountNumber: z.string().regex(ACCOUNT_NUMBER_PATTERN),
    currency: z.nativeEnum(Currency),
    mode: z.literal("PREPAID"),
    status: z.literal("ACTIVE"),
    isDefault: z.boolean(),
    label: LabelSchema,
    ledgerAccountId: z.string().uuid(),
    ledgerTaxonomy: z.literal("customer_funds"),
  })
  .strict();

export const ProvisionAuditDetailsSchema = z
  .object({ fingerprintVersion: z.literal(PROVISIONING_FINGERPRINT_VERSION) })
  .strict();

export const ProvisionDeniedDetailsSchema = z
  .object({
    targetTenantId: z.string().uuid().optional(),
    currency: z.nativeEnum(Currency).optional(),
  })
  .strict();

export const PROVISION_ALLOWED_REASON_CODES = ["ACCOUNT_PROVISIONED"] as const;
export const PROVISION_DENIED_REASON_CODES = [
  "PLATFORM_REQUIRED",
  "PERMISSION_DENIED",
  "STEP_UP_REQUIRED",
  "INVALID_REQUEST",
  "TARGET_TENANT_INELIGIBLE",
  "IDEMPOTENCY_CONFLICT",
  "ACCOUNT_CONFLICT",
  "ACCOUNT_NUMBER_EXHAUSTED",
] as const;
export type ProvisionDeniedReason = (typeof PROVISION_DENIED_REASON_CODES)[number];
