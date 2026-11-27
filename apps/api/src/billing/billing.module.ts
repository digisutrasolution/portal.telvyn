import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { AuthModule } from "@/auth/auth.module";
import { AuthzModule } from "@/authz/authz.module";
import { LedgerPostingService } from "./ledger-posting.service";
import { FinancialAuditDenialRecorder, FinancialAuditWriter } from "./financial-audit.writer";
import { BillingAccountProvisioningService } from "./billing-account-provisioning.service";
import { BillingAccountController } from "./billing-account.controller";

/**
 * Billing module — internal financial infrastructure plus the first governed
 * financial operation.
 *
 * - `LedgerPostingService` (Phase 13-1D): the sole application path to
 *   `billing.ledger_post`; inert (no endpoint, no caller).
 * - `FinancialAuditWriter` / `FinancialAuditDenialRecorder` (S2, S5): same-
 *   transaction ALLOWED events and own-transaction DENIED events.
 * - `BillingAccountProvisioningService` + `BillingAccountController` (S5):
 *   platform-only, step-up-protected, idempotent opening of zero-balance PREPAID
 *   BillingAccounts. No money movement, no opening balance, no wallet, invoice
 *   or payment — those are later, owner-gated slices.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [BillingAccountController],
  providers: [
    PrismaService,
    LedgerPostingService,
    FinancialAuditWriter,
    FinancialAuditDenialRecorder,
    BillingAccountProvisioningService,
  ],
  exports: [LedgerPostingService, FinancialAuditWriter],
})
export class BillingModule {}
