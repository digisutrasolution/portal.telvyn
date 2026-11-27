import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { LedgerPostingService } from "./ledger-posting.service";
import { FinancialAuditWriter } from "./financial-audit.writer";

/**
 * Billing module (Phase 13-1D) — internal financial infrastructure only.
 *
 * Provides the internal `LedgerPostingService` (the sole application path to the
 * merged `billing.ledger_post` SECURITY DEFINER function). There are NO
 * controllers, DTOs, or public endpoints here, and no commercial billing
 * (BillingAccount / Wallet / CreditProfile / invoicing / payments) — those are
 * later, owner-gated slices. The service is inert until a future AUTHORIZED
 * server operation constructs a TrustedLedgerContext and invokes it.
 */
@Module({
  // FinancialAuditWriter (Phase 13-2B S2, BA-14): internal same-transaction
  // financial audit; no controller, no caller, empty operation catalog (inert).
  providers: [PrismaService, LedgerPostingService, FinancialAuditWriter],
  exports: [LedgerPostingService, FinancialAuditWriter],
})
export class BillingModule {}
