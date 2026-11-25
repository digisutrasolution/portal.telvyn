import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { LedgerPostingService } from "./ledger-posting.service";

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
  providers: [PrismaService, LedgerPostingService],
  exports: [LedgerPostingService],
})
export class BillingModule {}
