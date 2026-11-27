import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { RequestContext } from "@/common/request-context";
import type { TenantContext } from "@/authz/tenant-context";

/**
 * Financial audit writer — ADR-0022 Amendment 5 BA-14, Phase 13-2B S2 (owner
 * decisions F1–F7, 2026-11-27).
 *
 * Appends one FinancialAuditEvent IN THE CALLER'S TRANSACTION, so the audit row
 * and the financial change commit or roll back together (fail closed): an audit
 * failure throws and rolls the change back; a later failure rolls the audit row
 * back. The writer:
 *   - holds NO database client of its own — it can only write through the
 *     interactive transaction client it is handed, and refuses a base client
 *     (anything exposing `$transaction`), so it can never fall back to an
 *     independent write, open a nested transaction or commit separately;
 *   - never retries and never swallows an error;
 *   - takes the actor ONLY from the server-derived TenantContext (ADR-0004) —
 *     there is no actor field in the event input (F3);
 *   - records decision ALLOWED only. The denied-attempt writer (own transaction,
 *     so it survives the rejected operation's rollback) is S5 work (F2).
 *
 * INERT in S2: FINANCIAL_AUDIT_OPERATIONS is empty (F1 — the first operation is
 * named in S5), so every production call is refused as unknown_operation.
 * The audit record is attribution evidence, never commercial authorization, and
 * never a substitute for a ledger entry.
 */

/** The approved financial operation catalog (F1). Empty until S5 names the first. */
export const FINANCIAL_AUDIT_OPERATIONS: ReadonlySet<string> = new Set<string>([]);

/** DI token used ONLY by tests to inject a test catalog; production uses the constant. */
export const FINANCIAL_AUDIT_OPERATION_CATALOG = Symbol("FINANCIAL_AUDIT_OPERATION_CATALOG");

/** Mirrors the database CHECKs (migration 20261127120000). */
export const FINANCIAL_AUDIT_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/;
export const FINANCIAL_AUDIT_REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
export const FINANCIAL_AUDIT_MAX_METADATA_BYTES = 4096;
export const FINANCIAL_AUDIT_MAX_METADATA_KEYS = 50;
export const FINANCIAL_AUDIT_MAX_CORRELATION_ID = 128;
const MAX_USER_AGENT = 512; // same bound as requestContext()
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

@Injectable()
export class FinancialAuditWriter {
  private readonly operations: ReadonlySet<string>;

  constructor(@Optional() @Inject(FINANCIAL_AUDIT_OPERATION_CATALOG) operations?: ReadonlySet<string>) {
    this.operations = operations ?? FINANCIAL_AUDIT_OPERATIONS;
    for (const op of this.operations) {
      if (!FINANCIAL_AUDIT_IDENTIFIER_PATTERN.test(op)) throw new Error("invalid financial audit operation catalog entry");
    }
  }

  /**
   * Validate and append one ALLOWED event using the caller's transaction client.
   * Throws FinancialAuditError on any validation failure; database errors
   * propagate unchanged (the caller's transaction then rolls back).
   */
  async record(tx: Prisma.TransactionClient, actor: FinancialAuditActor, event: FinancialAuditEventInput): Promise<{ id: string }> {
    assertTransactionClient(tx);
    const data = buildFinancialAuditRow(actor, event, this.operations);
    const row = await tx.financialAuditEvent.create({ data, select: { id: true } });
    return { id: row.id };
  }
}

/** Refuse anything that is not an interactive-transaction client (no fallback path). */
export function assertTransactionClient(tx: unknown): asserts tx is Prisma.TransactionClient {
  if (!tx || typeof tx !== "object") {
    throw new FinancialAuditError("not_in_transaction", "a transaction client is required");
  }
  if (typeof (tx as { $transaction?: unknown }).$transaction === "function") {
    throw new FinancialAuditError("not_in_transaction", "a base client cannot write financial audit; pass the caller's transaction client");
  }
  if (typeof (tx as { financialAuditEvent?: { create?: unknown } }).financialAuditEvent?.create !== "function") {
    throw new FinancialAuditError("not_in_transaction", "a transaction client is required");
  }
}

/** Pure validation + mapping to the insert row (exported for unit tests). */
export function buildFinancialAuditRow(
  actor: FinancialAuditActor | null | undefined,
  event: FinancialAuditEventInput | null | undefined,
  operations: ReadonlySet<string>,
): Prisma.FinancialAuditEventUncheckedCreateInput {
  const ctx = actor?.ctx;
  if (!ctx || !isUuid(ctx.userId) || !isUuid(ctx.tenantId) || !ctx.tenantType) {
    throw new FinancialAuditError("missing_context", "an authenticated tenant context is required");
  }
  if (!event || typeof event !== "object") throw new FinancialAuditError("invalid_event", "event is required");
  if (typeof event.operation !== "string" || !FINANCIAL_AUDIT_IDENTIFIER_PATTERN.test(event.operation)) {
    throw new FinancialAuditError("invalid_event", "operation is malformed");
  }
  if (!operations.has(event.operation)) {
    throw new FinancialAuditError("unknown_operation", "operation is not in the approved catalog");
  }
  if (!isUuid(event.tenantId)) throw new FinancialAuditError("invalid_event", "tenantId is required");
  // F4: a non-platform actor can only be attributed to its own tenant (DB FA004 too).
  if (event.tenantId !== ctx.tenantId && ctx.tenantType !== "PLATFORM") {
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

  const req = actor?.req;
  return {
    operation: event.operation,
    decision: "ALLOWED",
    actorUserId: ctx.userId,
    actorTenantId: ctx.tenantId,
    tenantId: event.tenantId,
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
    ipAddress: req?.ipAddress ?? null,
    userAgent: req?.userAgent ? req.userAgent.slice(0, MAX_USER_AGENT) : null,
  };
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
