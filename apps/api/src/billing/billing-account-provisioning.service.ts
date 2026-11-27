import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Currency } from "@prisma/client";
import type { RequestContext } from "@/common/request-context";
import type { TenantContext } from "@/authz/tenant-context";
import { AuditService } from "@/authz/audit.service";
import { PrismaService } from "@/infra/prisma.service";
import { runInTrackedTransaction } from "@/infra/tracked-transaction";
import { StepUpError, StepUpService } from "@/auth/step-up.service";
import { FinancialAuditDenialRecorder, FinancialAuditWriter } from "./financial-audit.writer";
import {
  ACCOUNT_NUMBER_MAX_ATTEMPTS,
  BILLING_ACCOUNT_PROVISION_OPERATION as OPERATION,
  BILLING_ACCOUNT_PROVISION_PERMISSION as PERMISSION,
  PROVISIONING_FINGERPRINT_VERSION,
  generateAccountNumberSuffix,
  isValidIdempotencyKey,
  provisioningFingerprint,
  type ProvisionBillingAccountInput,
  type ProvisionDeniedReason,
} from "./billing-account-provisioning.contract";

/** The server-derived caller: tenant context + the authenticated session id. */
export interface ProvisioningCaller {
  ctx: TenantContext;
  sessionId: string;
  req: RequestContext;
  correlationId?: string | null;
}

export interface ProvisionedBillingAccount {
  id: string;
  tenantId: string;
  accountNumber: string;
  label: string;
  currency: Currency;
  mode: "PREPAID";
  status: "ACTIVE";
  isDefault: boolean;
  ledgerAccountId: string;
  createdAt: string;
  /** true when this request replayed an earlier completed provisioning (O5). */
  replayed: boolean;
}

type ProvisionRow = {
  billing_account_id: string;
  ledger_account_id: string;
  account_number: string;
  label: string;
  currency: Currency;
  is_default: boolean;
  created_at: Date;
  replayed: boolean;
};

/** A refusal: the HTTP error plus the approved financial-audit reason code. */
class Refusal extends Error {
  constructor(
    readonly reason: ProvisionDeniedReason,
    readonly http: HttpException,
  ) {
    super(reason);
  }
}

const refusals: Record<ProvisionDeniedReason, () => HttpException> = {
  PLATFORM_REQUIRED: () => new ForbiddenException("Billing account provisioning is restricted to the platform operator"),
  PERMISSION_DENIED: () => new ForbiddenException("Missing required permission(s): billing.account.provision"),
  STEP_UP_REQUIRED: () => new ForbiddenException("A valid step-up grant for billing_account.provision is required"),
  INVALID_REQUEST: () => new BadRequestException("Invalid provisioning request"),
  TARGET_TENANT_INELIGIBLE: () =>
    new UnprocessableEntityException("The target tenant cannot own a billing account (it must be an active CUSTOMER or RESELLER tenant)"),
  IDEMPOTENCY_CONFLICT: () => new ConflictException("This Idempotency-Key was already used for a different request"),
  ACCOUNT_CONFLICT: () => new ConflictException("The tenant already has an open account with this label, or a default account in this currency"),
  ACCOUNT_NUMBER_EXHAUSTED: () => new InternalServerErrorException("Could not allocate a unique account number; retry with the same Idempotency-Key"),
};
const refuse = (reason: ProvisionDeniedReason) => new Refusal(reason, refusals[reason]());

/** SQLSTATEs raised by billing.billing_account_provision (migration 20261128150000). */
const SQLSTATE_REFUSAL: Record<string, ProvisionDeniedReason> = {
  BP001: "PLATFORM_REQUIRED",
  BP002: "PERMISSION_DENIED",
  BP003: "STEP_UP_REQUIRED",
  BP004: "TARGET_TENANT_INELIGIBLE",
  BP005: "INVALID_REQUEST",
  BP006: "IDEMPOTENCY_CONFLICT",
  BP008: "ACCOUNT_CONFLICT",
  "23505": "ACCOUNT_CONFLICT",
};
const ACCOUNT_NUMBER_COLLISION = "BP007";

function sqlstateOf(err: unknown): string | undefined {
  const e = err as { code?: string; meta?: { code?: string } };
  if (e?.code === "P2010" && typeof e.meta?.code === "string") return e.meta.code;
  return undefined;
}

/**
 * Platform-only PREPAID BillingAccount provisioning (Phase 13-2B S5; ADR-0022
 * Amendment 5 BA-03/BA-08/BA-14/BA-15; owner decisions O1–O7).
 *
 * Order of checks (O5 — a replay never bypasses current authorization):
 *   1. platform actor + explicit `billing.account.provision` (MFA-effective) —
 *      refusals are recorded as DENIED financial audit events in their own
 *      transaction;
 *   2. Idempotency-Key format; versioned canonical fingerprint (operation,
 *      actor, target tenant, currency, PREPAID, label, isDefault);
 *   3. ONE tracked transaction: consume the fresh step-up grant (single use,
 *      bound to user/session/tenant/purpose) → set the trusted platform ledger
 *      context (transaction-local) → billing.billing_account_provision (the
 *      database re-verifies platform authority, the explicit permission and that
 *      THIS transaction consumed the grant; serializes on the idempotency scope;
 *      replays or creates the account + its customer_funds ledger account) →
 *      for a new account, the ALLOWED financial audit event. Any failure rolls
 *      everything back, including the grant consumption.
 * A replay (same key, same fingerprint) needs a FRESH valid grant, returns the
 * original account and writes no second ALLOWED audit event. A deferred
 * constraint (BP010) refuses COMMIT of a provisioned account without its ledger
 * account and ALLOWED audit event. No money moves; no opening balance is posted.
 */
@Injectable()
export class BillingAccountProvisioningService {
  private readonly logger = new Logger("BillingAccountProvisioning");

  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUp: StepUpService,
    private readonly writer: FinancialAuditWriter,
    private readonly denials: FinancialAuditDenialRecorder,
    private readonly audit: AuditService,
  ) {}

  async provision(caller: ProvisioningCaller, input: ProvisionBillingAccountInput, idempotencyKey: unknown): Promise<ProvisionedBillingAccount> {
    try {
      const result = await this.authorizedProvision(caller, input, idempotencyKey);
      // Security telemetry (O6): request IP / user agent live here, not in the financial audit.
      await this.audit.log({
        ctx: caller.ctx,
        req: caller.req,
        action: result.replayed ? "billing_account.provision_replayed" : "billing_account.provisioned",
        resource: "billing_account",
        resourceId: result.id,
        metadata: { targetTenantId: result.tenantId, accountNumber: result.accountNumber },
      });
      return result;
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      await this.recordDenial(caller, input, idempotencyKey, e.reason);
      throw e.http;
    }
  }

  private async authorizedProvision(caller: ProvisioningCaller, input: ProvisionBillingAccountInput, idempotencyKey: unknown) {
    const { ctx } = caller;
    if (ctx.tenantType !== "PLATFORM") throw refuse("PLATFORM_REQUIRED");
    if (!ctx.permissions.has(PERMISSION)) throw refuse("PERMISSION_DENIED");
    if (!isValidIdempotencyKey(idempotencyKey)) throw refuse("INVALID_REQUEST");
    if (input.mode !== "PREPAID") throw refuse("INVALID_REQUEST");

    const fingerprint = provisioningFingerprint({
      actorUserId: ctx.userId,
      actorTenantId: ctx.tenantId,
      targetTenantId: input.targetTenantId,
      currency: input.currency,
      label: input.label,
      isDefault: input.isDefault,
    });

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(caller, input, idempotencyKey, fingerprint);
      } catch (e) {
        if (e instanceof Refusal) throw e;
        if (e instanceof StepUpError) throw refuse("STEP_UP_REQUIRED");
        const code = sqlstateOf(e);
        if (code === ACCOUNT_NUMBER_COLLISION) {
          if (attempt < ACCOUNT_NUMBER_MAX_ATTEMPTS) continue; // fresh random suffix; the whole tx rolled back
          throw refuse("ACCOUNT_NUMBER_EXHAUSTED");
        }
        const reason = code ? SQLSTATE_REFUSAL[code] : undefined;
        if (reason) throw refuse(reason);
        this.logger.error(`provisioning failed: ${code ?? (e instanceof Error ? e.name : "unknown")}`);
        throw e;
      }
    }
  }

  private async attempt(
    caller: ProvisioningCaller,
    input: ProvisionBillingAccountInput,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<ProvisionedBillingAccount> {
    const { ctx } = caller;
    return runInTrackedTransaction(this.prisma, async (tx) => {
      // Single-use step-up, consumed inside THIS transaction (rolled back on failure).
      await this.stepUp.consume(
        input.stepUpGrantId,
        { userId: ctx.userId, sessionId: caller.sessionId, tenantId: ctx.tenantId, purpose: OPERATION },
        tx,
      );
      // Trusted platform ledger context — transaction-local, all three set explicitly.
      await tx.$queryRaw`SELECT pg_catalog.set_config('app.tenant_id', '', true)`;
      await tx.$queryRaw`SELECT pg_catalog.set_config('app.is_platform', 'on', true)`;
      await tx.$queryRaw`SELECT pg_catalog.set_config('app.actor_id', ${ctx.userId}, true)`;

      const rows = await tx.$queryRaw<ProvisionRow[]>`
        SELECT * FROM billing.billing_account_provision(
          ${ctx.userId}::uuid, ${ctx.tenantId}::uuid, ${input.stepUpGrantId}::uuid,
          ${input.targetTenantId}::uuid, ${input.currency}::"Currency", ${input.label},
          ${input.isDefault}, ${generateAccountNumberSuffix()}, ${idempotencyKey}, ${fingerprint})`;
      const r = rows[0];
      if (!r) throw new Error("billing_account_provision returned no row");

      const account: ProvisionedBillingAccount = {
        id: r.billing_account_id,
        tenantId: input.targetTenantId,
        accountNumber: r.account_number,
        label: r.label,
        currency: r.currency,
        mode: "PREPAID",
        status: "ACTIVE",
        isDefault: r.is_default,
        ledgerAccountId: r.ledger_account_id,
        createdAt: new Date(r.created_at).toISOString(),
        replayed: r.replayed,
      };
      if (!r.replayed) {
        // Same transaction, values derived from the database result only (O6).
        await this.writer.record(tx, { ctx, req: caller.req }, {
          operation: OPERATION,
          tenantId: account.tenantId,
          billingAccountId: account.id,
          permission: PERMISSION,
          stepUpGrantId: input.stepUpGrantId,
          reasonCode: "ACCOUNT_PROVISIONED",
          after: {
            accountNumber: account.accountNumber,
            currency: account.currency,
            mode: "PREPAID",
            status: "ACTIVE",
            isDefault: account.isDefault,
            label: account.label,
            ledgerAccountId: account.ledgerAccountId,
            ledgerTaxonomy: "customer_funds",
          },
          details: { fingerprintVersion: PROVISIONING_FINGERPRINT_VERSION },
          idempotencyKey,
          correlationId: caller.correlationId ?? null,
        });
      }
      return account;
    });
  }

  /** DENIED attempt, own transaction (F2). A recording failure never turns a refusal into success. */
  private async recordDenial(caller: ProvisioningCaller, input: ProvisionBillingAccountInput, idempotencyKey: unknown, reason: ProvisionDeniedReason) {
    try {
      await this.denials.recordDenied(
        { ctx: caller.ctx, req: caller.req },
        {
          operation: OPERATION,
          permission: PERMISSION,
          reasonCode: reason,
          details: { targetTenantId: input.targetTenantId, currency: input.currency },
          idempotencyKey: isValidIdempotencyKey(idempotencyKey) ? idempotencyKey : null,
          correlationId: caller.correlationId ?? null,
        },
      );
    } catch (err) {
      this.logger.error(`denied-attempt audit failed for ${reason}: ${err instanceof Error ? err.name : "unknown"}`);
      throw new InternalServerErrorException("The request was refused and its audit record could not be written");
    }
  }
}
