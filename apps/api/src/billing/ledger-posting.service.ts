/**
 * Internal ledger posting service (Phase 13-1D) — the ONLY application path that
 * invokes the merged `billing.ledger_post` function. It is internal
 * infrastructure: NO HTTP/GraphQL endpoint, NO DTO, NO customer/admin action,
 * NO commercial workflow. It stays inert until a future AUTHORIZED server
 * operation (13-2+) constructs a TrustedLedgerContext and calls it.
 *
 * Security model (§14–§19):
 *   - Requires a Symbol-branded TrustedLedgerContext (unforgeable from request
 *     data) — fail-closed; a forged/plain object is rejected.
 *   - Establishes app.tenant_id / app.is_platform / app.actor_id from the trusted
 *     context ONLY, ALL THREE explicitly set (no inheritance across pooled
 *     connections), TRANSACTION-LOCAL (set_config(..., true)), on the SAME tx
 *     client/connection used to call ledger_post. Values are parameterized —
 *     never string-interpolated.
 *   - A caller-settable GUC is NOT tenant authentication (§19): a compromised
 *     telvyn_app credential could set a context via arbitrary SQL. This adapter
 *     protects the normal trusted application path; it does not, and does not
 *     claim to, implement RLS or defend against raw SQL under a leaked runtime role.
 */
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { LedgerError, mapLedgerError } from "./ledger-errors";
import {
  type LedgerPostInput,
  type TrustedLedgerContext,
  buildLedgerPostPayload,
  isTrustedLedgerContext,
} from "./ledger-contract";

/** A posting result that has COMMITTED (deferred invariants passed at commit). */
export interface CommittedLedgerPost {
  readonly transactionId: string;
  readonly committed: true;
}
/** A posting result that is PENDING the caller transaction's commit. The deferred
 *  COMMIT-time invariants have NOT yet run — the caller owns (and must check) the
 *  commit before treating this as financially final (§17). */
export interface PendingLedgerPost {
  readonly transactionId: string;
  readonly committed: false;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class LedgerPostingService {
  private readonly logger = new Logger("LedgerPosting");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Post within an EXISTING caller transaction (future composition: open tx →
   * acquire BillingAccount lock → validate policy → post → commit). Establishes
   * trusted context + posts on the SAME `tx`. The returned id is PENDING until
   * the caller commits; the caller must surface a commit failure (deferred
   * invariants) — do not treat a pending result as success.
   */
  async postInTransaction(tx: Tx, ctx: TrustedLedgerContext, input: LedgerPostInput): Promise<PendingLedgerPost> {
    if (!isTrustedLedgerContext(ctx)) {
      throw new LedgerError("MISSING_AUTHORIZATION_CONTEXT", "a trusted ledger context is required");
    }
    try {
      // Validate + assemble the payload (typed values only) and establish ALL
      // context GUCs explicitly + transaction-locally on this tx connection.
      const payload = buildLedgerPostPayload(ctx, input);
      const tenantIdValue = ctx.owner.kind === "tenant" ? ctx.owner.tenantId : "";
      const platformValue = ctx.owner.kind === "platform" ? "on" : "off";
      const actorValue = ctx.actorId ?? "";
      await tx.$queryRaw`SELECT pg_catalog.set_config('app.tenant_id', ${tenantIdValue}, true)`;
      await tx.$queryRaw`SELECT pg_catalog.set_config('app.is_platform', ${platformValue}, true)`;
      await tx.$queryRaw`SELECT pg_catalog.set_config('app.actor_id', ${actorValue}, true)`;

      const payloadJson = JSON.stringify(payload);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT billing.ledger_post(${payloadJson}::jsonb) AS id`;
      const transactionId = rows[0]?.id;
      if (!transactionId) throw new LedgerError("UNKNOWN", "ledger_post returned no transaction id");
      return { transactionId, committed: false };
    } catch (err) {
      const mapped = mapLedgerError(err);
      // Correlation only — never the payload, amounts, context values, or SQL.
      this.logger.warn(`ledger post rejected: ${mapped.kind}${mapped.sqlstate ? ` (${mapped.sqlstate})` : ""} op=${ctx.operation}`);
      throw mapped;
    }
  }

  /**
   * Post in a self-contained transaction. Returns only AFTER commit, so the
   * deferred COMMIT-time invariants (balance, completeness, …) have passed — a
   * committed result is financially final. Used where no outer transaction /
   * account lock is required (13-1 posts are self-contained; locking arrives in 13-2).
   */
  async post(ctx: TrustedLedgerContext, input: LedgerPostInput): Promise<CommittedLedgerPost> {
    if (!isTrustedLedgerContext(ctx)) {
      throw new LedgerError("MISSING_AUTHORIZATION_CONTEXT", "a trusted ledger context is required");
    }
    try {
      const { transactionId } = await this.prisma.$transaction(async (tx) => this.postInTransaction(tx, ctx, input));
      return { transactionId, committed: true };
    } catch (err) {
      throw mapLedgerError(err); // deferred COMMIT-time failures surface here
    }
  }
}
