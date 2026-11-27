import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ZodTypeAny } from "zod";
import type { RequestContext } from "@/common/request-context";
import type { TenantContext } from "@/authz/tenant-context";
import { PrismaService } from "@/infra/prisma.service";
import { assertLiveTransaction, isTrackedTransaction, runInTrackedTransaction } from "@/infra/tracked-transaction";
import {
  BILLING_ACCOUNT_PROVISION_OPERATION,
  BILLING_ACCOUNT_PROVISION_PERMISSION,
  PROVISION_ALLOWED_REASON_CODES,
  PROVISION_DENIED_REASON_CODES,
  ProvisionAuditAfterSchema,
  ProvisionAuditDetailsSchema,
  ProvisionDeniedDetailsSchema,
} from "./billing-account-provisioning.contract";

/**
 * Financial audit writer — ADR-0022 Amendment 5 BA-14, Phase 13-2B S2 (owner
 * decisions F1–F7, 2026-11-27), extended in S5 (owner decisions O6/O7, P5).
 *
 * ALLOWED events (`FinancialAuditWriter.record`) are appended IN THE CALLER'S
 * TRANSACTION, so the audit row and the financial change commit or roll back
 * together (fail closed). The writer:
 *   - holds NO database client of its own for ALLOWED events and accepts only a
 *     transaction client opened by runInTrackedTransaction (in-process
 *     provenance), then proves on the database that the client is an open
 *     transaction block (P5) — no fallback, no nested transaction;
 *   - never retries and never swallows an error;
 *   - takes the actor ONLY from the server-derived TenantContext (ADR-0004) —
 *     there is no actor field in the event input (F3);
 *   - validates before/after/details against the operation's STRICT typed
 *     schema and approved reason codes (O6), on top of the F5 size and
 *     sensitive-key rules;
 *   - stores NO client IP address or user agent (O6): request network data is
 *     security telemetry (AuditLog / SecurityEvent), not immutable financial
 *     evidence;
 *   - inserts without RETURNING (the id comes from uuidv7() first), so the
 *     runtime role needs INSERT only — no SELECT on the table (O7).
 *
 * DENIED events (`FinancialAuditDenialRecorder.recordDenied`) are written in
 * their OWN tracked transaction (F2), so the record survives the rejected
 * operation's rollback. A denial is always attributed to the actor's own
 * tenant (the target may not exist); the target appears only as typed details.
 *
 * The audit record is attribution evidence, never commercial authorization, and
 * never a substitute for a ledger entry.
 */

/** Strict typed metadata for one operation (O6). `null` means "must be absent". */
export interface FinancialAuditOperationSpec {
  /** The permission an ALLOWED event must record. */
  permission: string;
  allowed: { before: ZodTypeAny | null; after: ZodTypeAny | null; details: ZodTypeAny | null; reasonCodes: readonly string[] };
  denied: { details: ZodTypeAny | null; reasonCodes: readonly string[] };
}

/** The approved financial operation catalog (F1; first operation named in S5). */
export const FINANCIAL_AUDIT_OPERATIONS: ReadonlyMap<string, FinancialAuditOperationSpec> = new Map([
  [
    BILLING_ACCOUNT_PROVISION_OPERATION,
    {
      permission: BILLING_ACCOUNT_PROVISION_PERMISSION,
      allowed: {
        before: null,
        after: ProvisionAuditAfterSchema,
        details: ProvisionAuditDetailsSchema,
        reasonCodes: PROVISION_ALLOWED_REASON_CODES,
      },
      denied: { details: ProvisionDeniedDetailsSchema, reasonCodes: PROVISION_DENIED_REASON_CODES },
    },
  ],
]);

/**
 * DI token used ONLY by tests to inject a test catalog. A plain Set of names is
 * accepted for tests and maps to an untyped spec (F5 rules only, any reason
 * code); production always uses the typed constant above.
 */
export const FINANCIAL_AUDIT_OPERATION_CATALOG = Symbol("FINANCIAL_AUDIT_OPERATION_CATALOG");
export type FinancialAuditCatalogInput = ReadonlySet<string> | ReadonlyMap<string, FinancialAuditOperationSpec>;
type CatalogEntry = FinancialAuditOperationSpec | "untyped";

/** Mirrors the database CHECKs (migration 20261127120000). */
export const FINANCIAL_AUDIT_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/;
export const FINANCIAL_AUDIT_REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
export const FINANCIAL_AUDIT_MAX_METADATA_BYTES = 4096;
export const FINANCIAL_AUDIT_MAX_METADATA_KEYS = 50;
export const FINANCIAL_AUDIT_MAX_CORRELATION_ID = 128;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sensitive key names (F5). Matched per word of a key (camelCase, snake_case,
 * kebab-case and dotted keys are split), plus compound names matched on the
 * whole normalized key. Any hit — at any depth — rejects the WHOLE event.
 */
const SENSITIVE_KEY_WORDS: ReadonlySet<string> = new Set([
  "password", "passwd", "pwd", "passphrase", "secret", "secrets", "token", "tokens", "jwt",
  "totp", "otp", "mfa", "recovery", "credential", "credentials", "cvv", "cvv2", "cvc", "cvc2",
  "pan", "dsn",
]);
const SENSITIVE_KEY_COMPOUNDS: readonly string[] = [
  "cardnumber", "connectionstring", "databaseurl", "apikey", "privatekey", "accesskey",
  "accesstoken", "refreshtoken", "authorizationheader", "securitycode",
];

export type FinancialAuditFailure =
  | "not_in_transaction"
  | "missing_context"
  | "unknown_operation"
  | "invalid_event"
  | "sensitive_metadata"
  | "attribution_mismatch";

/** Thrown before any insert. Messages are generic — no submitted value is echoed. */
export class FinancialAuditError extends Error {
  constructor(readonly reason: FinancialAuditFailure, detail: string) {
    super(`financial audit refused (${reason}): ${detail}`);
    this.name = "FinancialAuditError";
  }
}

/** Server-derived actor: the authenticated TenantContext plus request metadata. */
export interface FinancialAuditActor {
  ctx: TenantContext;
  /** Request metadata — NOT stored in the financial audit (O6); for callers' telemetry. */
  req: RequestContext;
}

/** The event. Deliberately has NO actor field: attribution comes from the context only. */
export interface FinancialAuditEventInput {
  operation: string;
  /** Owner of the affected financial object (F4). */
  tenantId: string;
  billingAccountId?: string | null;
  /** The permission key that authorized the operation. */
  permission?: string | null;
  /** A step-up grant consumed for this operation; must belong to the actor (DB FA005). */
  stepUpGrantId?: string | null;
  reasonCode: string;
  before?: unknown;
  after?: unknown;
  details?: unknown;
  /** Reference only — never unique, never deduplicated by the audit (F7). */
  idempotencyKey?: string | null;
  ledgerTransactionId?: string | null;
  correlationId?: string | null;
}

/** The validated insert row (no IP / user agent — O6). */
export interface FinancialAuditRow {
  operation: string;
  decision: "ALLOWED" | "DENIED";
  actorUserId: string;
  actorTenantId: string;
  tenantId: string;
  billingAccountId: string | null;
  permission: string | null;
  stepUpGrantId: string | null;
  reasonCode: string;
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
  details?: Prisma.InputJsonObject;
  idempotencyKey: string | null;
  ledgerTransactionId: string | null;
  correlationId: string | null;
}

export type DeniedEventInput = Pick<
  FinancialAuditEventInput,
  "operation" | "permission" | "reasonCode" | "details" | "idempotencyKey" | "correlationId"
>;

/** Normalize a catalog input; a Set (tests only) maps every name to "untyped". */
export function financialAuditCatalog(input?: FinancialAuditCatalogInput): ReadonlyMap<string, CatalogEntry> {
  const src = input ?? FINANCIAL_AUDIT_OPERATIONS;
  const out = new Map<string, CatalogEntry>();
  if (src instanceof Map) for (const [k, v] of src as ReadonlyMap<string, FinancialAuditOperationSpec>) out.set(k, v);
  else for (const k of src as ReadonlySet<string>) out.set(k, "untyped");
  for (const op of out.keys()) {
    if (!FINANCIAL_AUDIT_IDENTIFIER_PATTERN.test(op)) throw new Error("invalid financial audit operation catalog entry");
  }
  return out;
}

@Injectable()
export class FinancialAuditWriter {
  private readonly catalog: ReadonlyMap<string, CatalogEntry>;

  constructor(@Optional() @Inject(FINANCIAL_AUDIT_OPERATION_CATALOG) operations?: FinancialAuditCatalogInput) {
    this.catalog = financialAuditCatalog(operations);
  }

  /**
   * Validate and append one ALLOWED event using the caller's tracked transaction
   * client. Throws FinancialAuditError on any validation failure; database errors
   * propagate unchanged (the caller's transaction then rolls back).
   */
  async record(tx: Prisma.TransactionClient, actor: FinancialAuditActor, event: FinancialAuditEventInput): Promise<{ id: string }> {
    assertTransactionClient(tx);
    const row = buildFinancialAuditRow(actor, event, this.catalog, "ALLOWED");
    try {
      await assertLiveTransaction(tx);
    } catch {
      throw new FinancialAuditError("not_in_transaction", "the client is not an open transaction");
    }
    return insertFinancialAuditRow(tx, row);
  }
}

/**
 * DENIED-attempt recorder (F2, S5). Owns its client and writes each denial in
 * its OWN tracked transaction, independent of the rejected operation.
 */
@Injectable()
export class FinancialAuditDenialRecorder {
  private readonly catalog: ReadonlyMap<string, CatalogEntry>;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(FINANCIAL_AUDIT_OPERATION_CATALOG) operations?: FinancialAuditCatalogInput,
  ) {
    this.catalog = financialAuditCatalog(operations);
  }

  async recordDenied(actor: FinancialAuditActor, event: DeniedEventInput): Promise<{ id: string }> {
    // A denial is attributed to the actor's own tenant (the target may not exist
    // or may be foreign); the target is carried only in the typed details.
    const row = buildFinancialAuditRow(actor, { ...event, tenantId: actor?.ctx?.tenantId }, this.catalog, "DENIED");
    return runInTrackedTransaction(this.prisma, async (tx) => {
      await assertLiveTransaction(tx);
      return insertFinancialAuditRow(tx, row);
    });
  }
}

/** One INSERT, no RETURNING (O7): the id is allocated first with uuidv7(). */
async function insertFinancialAuditRow(tx: Prisma.TransactionClient, r: FinancialAuditRow): Promise<{ id: string }> {
  const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id`;
  const id = ids[0]?.id;
  if (!id) throw new FinancialAuditError("invalid_event", "could not allocate an id");
  const json = (v: Prisma.InputJsonObject | undefined) => (v === undefined ? null : JSON.stringify(v));
  await tx.$executeRaw`
    INSERT INTO "FinancialAuditEvent"
      ("id", "operation", "decision", "actorUserId", "actorTenantId", "tenantId", "billingAccountId",
       "permission", "stepUpGrantId", "reasonCode", "before", "after", "details",
       "idempotencyKey", "ledgerTransactionId", "correlationId")
    VALUES
      (${id}::uuid, ${r.operation}, ${r.decision}::"FinancialAuditDecision", ${r.actorUserId}::uuid,
       ${r.actorTenantId}::uuid, ${r.tenantId}::uuid, ${r.billingAccountId}::uuid,
       ${r.permission}, ${r.stepUpGrantId}::uuid, ${r.reasonCode}, ${json(r.before)}::jsonb,
       ${json(r.after)}::jsonb, ${json(r.details)}::jsonb,
       ${r.idempotencyKey}, ${r.ledgerTransactionId}::uuid, ${r.correlationId})`;
  return { id };
}

/** Refuse anything that is not a tracked interactive-transaction client (no fallback path). */
export function assertTransactionClient(tx: unknown): asserts tx is Prisma.TransactionClient {
  if (!tx || typeof tx !== "object") {
    throw new FinancialAuditError("not_in_transaction", "a transaction client is required");
  }
  if (typeof (tx as { $transaction?: unknown }).$transaction === "function") {
    throw new FinancialAuditError("not_in_transaction", "a base client cannot write financial audit; pass the caller's transaction client");
  }
  if (!isTrackedTransaction(tx)) {
    throw new FinancialAuditError("not_in_transaction", "the transaction was not opened by runInTrackedTransaction");
  }
}

/** Pure validation + mapping to the insert row (exported for unit tests). */
export function buildFinancialAuditRow(
  actor: FinancialAuditActor | null | undefined,
  event: (Omit<FinancialAuditEventInput, "tenantId"> & { tenantId: string | undefined }) | null | undefined,
  operations: FinancialAuditCatalogInput | ReadonlyMap<string, CatalogEntry>,
  decision: "ALLOWED" | "DENIED" = "ALLOWED",
): FinancialAuditRow {
  const catalog = isNormalizedCatalog(operations) ? operations : financialAuditCatalog(operations as FinancialAuditCatalogInput);
  const ctx = actor?.ctx;
  if (!ctx || !isUuid(ctx.userId) || !isUuid(ctx.tenantId) || !ctx.tenantType) {
    throw new FinancialAuditError("missing_context", "an authenticated tenant context is required");
  }
  if (!event || typeof event !== "object") throw new FinancialAuditError("invalid_event", "event is required");
  if (typeof event.operation !== "string" || !FINANCIAL_AUDIT_IDENTIFIER_PATTERN.test(event.operation)) {
    throw new FinancialAuditError("invalid_event", "operation is malformed");
  }
  const spec = catalog.get(event.operation);
  if (!spec) throw new FinancialAuditError("unknown_operation", "operation is not in the approved catalog");
  if (!isUuid(event.tenantId)) throw new FinancialAuditError("invalid_event", "tenantId is required");
  const tenantId = event.tenantId;
  // F4: a non-platform actor can only be attributed to its own tenant (DB FA004 too).
  if (tenantId !== ctx.tenantId && ctx.tenantType !== "PLATFORM") {
    throw new FinancialAuditError("attribution_mismatch", "actor tenant does not own the audited object");
  }
  if (typeof event.reasonCode !== "string" || !FINANCIAL_AUDIT_REASON_CODE_PATTERN.test(event.reasonCode)) {
    throw new FinancialAuditError("invalid_event", "reasonCode is malformed");
  }
  const permission = optional(event.permission, (v) => FINANCIAL_AUDIT_IDENTIFIER_PATTERN.test(v), "permission");
  const billingAccountId = optional(event.billingAccountId, isUuid, "billingAccountId");
  const stepUpGrantId = optional(event.stepUpGrantId, isUuid, "stepUpGrantId");
  const ledgerTransactionId = optional(event.ledgerTransactionId, isUuid, "ledgerTransactionId");
  const correlationId = optional(
    event.correlationId,
    (v) => v.length >= 1 && v.length <= FINANCIAL_AUDIT_MAX_CORRELATION_ID,
    "correlationId",
  );
  const idempotencyKey = optional(event.idempotencyKey, (v) => v.length >= 1, "idempotencyKey");

  const before = normalizeFinancialAuditMetadata(event.before, "before");
  const after = normalizeFinancialAuditMetadata(event.after, "after");
  const details = normalizeFinancialAuditMetadata(event.details, "details");

  if (spec !== "untyped") {
    // O6: strict operation-specific schemas and approved reason codes.
    if (decision === "ALLOWED") {
      if (permission !== spec.permission) throw new FinancialAuditError("invalid_event", "permission does not match the operation");
      if (!spec.allowed.reasonCodes.includes(event.reasonCode)) {
        throw new FinancialAuditError("invalid_event", "reasonCode is not approved for the operation");
      }
      checkSchema(spec.allowed.before, before, "before");
      checkSchema(spec.allowed.after, after, "after");
      checkSchema(spec.allowed.details, details, "details");
    } else {
      if (permission !== null && permission !== spec.permission) {
        throw new FinancialAuditError("invalid_event", "permission does not match the operation");
      }
      if (!spec.denied.reasonCodes.includes(event.reasonCode)) {
        throw new FinancialAuditError("invalid_event", "reasonCode is not approved for the operation");
      }
      if (before !== undefined || after !== undefined || billingAccountId !== null || stepUpGrantId !== null || ledgerTransactionId !== null) {
        throw new FinancialAuditError("invalid_event", "a denial carries no state, account, grant or ledger reference");
      }
      checkSchema(spec.denied.details, details, "details");
    }
  }

  return {
    operation: event.operation,
    decision,
    actorUserId: ctx.userId,
    actorTenantId: ctx.tenantId,
    tenantId,
    billingAccountId,
    permission,
    stepUpGrantId,
    reasonCode: event.reasonCode,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(details !== undefined ? { details } : {}),
    idempotencyKey,
    ledgerTransactionId,
    correlationId,
  };
}

function isNormalizedCatalog(v: unknown): v is ReadonlyMap<string, CatalogEntry> {
  return v instanceof Map && [...v.values()].every((e) => e === "untyped" || (typeof e === "object" && e !== null && "allowed" in e));
}

function checkSchema(schema: ZodTypeAny | null, value: Prisma.InputJsonObject | undefined, field: string): void {
  if (schema === null) {
    if (value !== undefined) throw new FinancialAuditError("invalid_event", `${field} must be absent for this operation`);
    return;
  }
  if (value === undefined || !schema.safeParse(value).success) {
    throw new FinancialAuditError("invalid_event", `${field} does not match the operation schema`);
  }
}

/**
 * F5: undefined/null → absent; otherwise a plain JSON object of ≤ 50 top-level
 * keys and ≤ 4096 bytes in PostgreSQL jsonb text form, with no sensitive key at
 * any depth. The database CHECK (billing.financial_audit_json_ok) is authoritative.
 */
export function normalizeFinancialAuditMetadata(value: unknown, field: string): Prisma.InputJsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw new FinancialAuditError("invalid_event", `${field} must be a plain JSON object`);
  if (Object.keys(value).length > FINANCIAL_AUDIT_MAX_METADATA_KEYS) {
    throw new FinancialAuditError("invalid_event", `${field} has too many keys`);
  }
  let bytes: number;
  try {
    bytes = Buffer.byteLength(jsonbText(value), "utf8");
  } catch {
    throw new FinancialAuditError("invalid_event", `${field} is not JSON-serializable`);
  }
  if (bytes > FINANCIAL_AUDIT_MAX_METADATA_BYTES) throw new FinancialAuditError("invalid_event", `${field} is too large`);
  if (containsSensitiveKey(value)) {
    throw new FinancialAuditError("sensitive_metadata", `${field} contains a sensitive key`);
  }
  return value as Prisma.InputJsonObject;
}

/** True when any object key at any depth names a secret/credential (F5). */
export function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key) || containsSensitiveKey(child)) return true;
  }
  return false;
}

export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => SENSITIVE_KEY_WORDS.has(w))) return true;
  const joined = words.join("");
  return SENSITIVE_KEY_COMPOUNDS.some((c) => joined.includes(c));
}

/**
 * Serialize like PostgreSQL's jsonb text output (", " and ": " separators) so the
 * writer's size check matches the database CHECK. Throws on non-JSON values.
 */
function jsonbText(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  if (isPlainObject(v)) {
    return `{${Object.entries(v)
      .map(([k, c]) => `${JSON.stringify(k)}: ${jsonbText(c)}`)
      .join(", ")}}`;
  }
  throw new Error("unsupported JSON value");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function optional(v: unknown, ok: (s: string) => boolean, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !ok(v)) throw new FinancialAuditError("invalid_event", `${field} is malformed`);
  return v;
}
