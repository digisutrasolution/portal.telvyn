import { BadRequestException, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "@/infra/prisma.service";
import { loadEnv } from "@/config/env";
import { randomToken, sha256 } from "@/common/crypto.util";
import type { RequestContext } from "@/common/request-context";
import { SecurityEventsService } from "./security-events.service";

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Password reset + email verification. Tokens are 256-bit, stored hashed,
 * single-use, TTL-bound. Messages go to the EmailOutbox seam (ADR-0003) —
 * SMTP wiring is deploy configuration, never a fake send.
 */
@Injectable()
export class AccountFlowsService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: SecurityEventsService,
  ) {}

  /** Always resolves (202) — no account enumeration. */
  async requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status === "DISABLED") return;

    const token = randomToken();
    await this.prisma.$transaction([
      // Invalidate outstanding reset tokens — only the newest is valid.
      this.prisma.emailToken.updateMany({
        where: { userId: user.id, type: "RESET_PASSWORD", usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailToken.create({
        data: {
          userId: user.id,
          type: "RESET_PASSWORD",
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      }),
      this.prisma.emailOutbox.create({
        data: {
          toEmail: user.email,
          subject: "Reset your Telvyn password",
          purpose: "password_reset",
          body: `A password reset was requested for your Telvyn account. Use this link within 30 minutes:\n${this.env.WEB_ORIGIN}/reset-password?token=${token}\n\nIf you did not request this, you can ignore this message; your password is unchanged.`,
        },
      }),
    ]);
    await this.events.record("auth.password_reset_requested", ctx, user.id);
  }

  /** Consume a reset token, set the new password, revoke ALL sessions. */
  async confirmPasswordReset(rawToken: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const now = new Date();
    const record = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!record || record.type !== "RESET_PASSWORD" || record.usedAt || record.expiresAt < now) {
      throw new BadRequestException("Invalid or expired reset token");
    }

    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: "password_reset" },
      }),
    ]);
    await this.events.record("auth.password_reset_completed", ctx, record.userId);
  }

  async requestEmailVerification(userId: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;

    const token = randomToken();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({
        where: { userId, type: "VERIFY_EMAIL", usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailToken.create({
        data: {
          userId,
          type: "VERIFY_EMAIL",
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        },
      }),
      this.prisma.emailOutbox.create({
        data: {
          toEmail: user.email,
          subject: "Verify your Telvyn email address",
          purpose: "email_verification",
          body: `Confirm this email address for your Telvyn account within 24 hours:\n${this.env.WEB_ORIGIN}/verify-email?token=${token}`,
        },
      }),
    ]);
    await this.events.record("auth.email_verification_requested", ctx, userId);
  }

  async confirmEmailVerification(rawToken: string, ctx: RequestContext): Promise<void> {
    const now = new Date();
    const record = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!record || record.type !== "VERIFY_EMAIL" || record.usedAt || record.expiresAt < now) {
      throw new BadRequestException("Invalid or expired verification token");
    }
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } }),
    ]);
    await this.events.record("auth.email_verified", ctx, record.userId);
  }
}
