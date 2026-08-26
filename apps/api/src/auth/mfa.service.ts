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
    if (!this.checkTotp(user.mfaSecretEnc, code)) throw new BadRequestException("Invalid code");

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

    if (/^\d{6}$/.test(code) && this.checkTotp(user.mfaSecretEnc, code)) return true;

    // Recovery code path — single-use, atomically consumed.
    const consumed = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: sha256(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return consumed.count === 1;
  }

  private checkTotp(secretEnc: string, code: string): boolean {
    try {
      return authenticator.check(code, decryptSecret(secretEnc, this.env.APP_ENCRYPTION_KEY));
    } catch {
      return false;
    }
  }
}
