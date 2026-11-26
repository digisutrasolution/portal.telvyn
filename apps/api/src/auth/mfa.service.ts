import { BadRequestException, Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import { PrismaService } from "@/infra/prisma.service";
import { loadEnv } from "@/config/env";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/common/crypto.util";

/** TOTP MFA + one-time recovery codes. Secrets encrypted at rest (AES-256-GCM). */
@Injectable()
export class MfaService {
  private readonly env = loadEnv();

  constructor(private readonly prisma: PrismaService) {
    authenticator.options = { window: 1 };
  }

  /** Begin enrollment: store an encrypted pending secret; MFA not enabled until proven. */
  async enroll(userId: string, email: string): Promise<{ otpauthUri: string }> {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: encryptSecret(secret, this.env.APP_ENCRYPTION_KEY), mfaEnabled: false },
    });
    return { otpauthUri: authenticator.keyuri(email, this.env.MFA_ISSUER, secret) };
  }

  /** Prove a code against the pending secret → enable MFA, issue recovery codes (returned once). */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecretEnc) throw new BadRequestException("No MFA enrollment in progress");
    if (user.mfaEnabled) throw new BadRequestException("MFA is already enabled");
    if (!(await this.acceptTotp(userId, user.mfaSecretEnc, code))) throw new BadRequestException("Invalid code");

    const recoveryCodes = Array.from({ length: 8 }, () => randomToken(10));
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId, codeHash: sha256(c) })),
      }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } }),
    ]);
    return { recoveryCodes };
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } }),
    ]);
  }

  /** Verify a TOTP code or consume a recovery code during login/step-up. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) return false;

    if (/^\d{6}$/.test(code)) return this.acceptTotp(userId, user.mfaSecretEnc, code);

    // Recovery code path — single-use, atomically consumed.
    const consumed = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: sha256(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return consumed.count === 1;
  }

  /**
   * Verify a TOTP code ONLY (no recovery-code fallback) with the replay guard.
   * Used where a fresh authenticator proof is required (financial step-up, BA-15).
   */
  async verifyTotpOnly(userId: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) return false;
    return this.acceptTotp(userId, user.mfaSecretEnc, code);
  }

  /**
   * TOTP replay guard (ADR-0022 Amendment 5 BA-15, Phase 13-2B S1). A code is
   * accepted only if its time step is STRICTLY greater than the user's stored
   * last-accepted step; the step is recorded by one conditional UPDATE, so two
   * concurrent presentations of the same code cannot both succeed. Applies to
   * every TOTP path (enable, login, step-up).
   */
  private async acceptTotp(userId: string, secretEnc: string, code: string): Promise<boolean> {
    const step = this.matchTotpStep(secretEnc, code);
    if (step === null) return false;
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastTotpStep: null }, { mfaLastTotpStep: { lt: step } }] },
      data: { mfaLastTotpStep: step },
    });
    return claimed.count === 1;
  }

  /** The absolute TOTP time step the code matches (within the ±1 window), or null. */
  private matchTotpStep(secretEnc: string, code: string): number | null {
    try {
      // One fixed epoch for both the check and the step arithmetic (no boundary skew).
      const epoch = Date.now();
      const checker = authenticator.clone({ epoch });
      const delta = checker.checkDelta(code, decryptSecret(secretEnc, this.env.APP_ENCRYPTION_KEY));
      if (delta === null) return null;
      const stepSeconds = checker.allOptions().step ?? 30;
      return Math.floor(epoch / 1000 / stepSeconds) + delta;
    } catch {
      return null;
    }
  }
}
