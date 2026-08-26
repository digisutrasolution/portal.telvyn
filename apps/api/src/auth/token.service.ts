import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "@/infra/prisma.service";
import { loadEnv } from "@/config/env";
import { randomToken, sha256 } from "@/common/crypto.util";
import { deviceLabel, type RequestContext } from "@/common/request-context";
import { SecurityEventsService } from "./security-events.service";

export interface AccessClaims {
  sub: string;
  sid: string;
  purpose: "access";
}

export interface MfaClaims {
  sub: string;
  purpose: "mfa";
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
}

/**
 * JWT access tokens + opaque rotating refresh tokens with reuse detection.
 * Refresh tokens are 256-bit random values stored only as SHA-256 digests;
 * every rotation marks the presented token used and issues a successor.
 * A presented-but-already-used token = theft signal → the session is revoked
 * and a security event is recorded.
 */
@Injectable()
export class TokenService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly events: SecurityEventsService,
  ) {}

  signAccess(userId: string, sessionId: string): { accessToken: string; expiresIn: number } {
    const claims: AccessClaims = { sub: userId, sid: sessionId, purpose: "access" };
    return {
      accessToken: this.jwt.sign(claims, { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS }),
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    };
  }

  signMfaToken(userId: string): string {
    const claims: MfaClaims = { sub: userId, purpose: "mfa" };
    return this.jwt.sign(claims, { expiresIn: 300 });
  }

  verifyMfaToken(token: string): string {
    try {
      const claims = this.jwt.verify<MfaClaims>(token);
      if (claims.purpose !== "mfa") throw new Error("wrong purpose");
      return claims.sub;
    } catch {
      throw new UnauthorizedException("Invalid or expired MFA token");
    }
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const claims = this.jwt.verify<AccessClaims>(token);
      if (claims.purpose !== "access") throw new Error("wrong purpose");
      return claims;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  /** Create a session + first refresh token (login / MFA completion). */
  async createSession(userId: string, ctx: RequestContext): Promise<IssuedTokens> {
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
        deviceLabel: deviceLabel(ctx.userAgent),
        expiresAt,
        refreshTokens: { create: { tokenHash: sha256(refreshToken), expiresAt } },
      },
    });

    const access = this.signAccess(userId, session.id);
    return { ...access, refreshToken, sessionId: session.id };
  }

  /** Rotate a refresh token. Throws 401 on unknown/expired/revoked; revokes the session on reuse. */
  async rotate(presented: string, ctx: RequestContext): Promise<IssuedTokens> {
    const tokenHash = sha256(presented);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!stored) throw new UnauthorizedException("Invalid refresh token");

    const { session } = stored;

    if (stored.usedAt) {
      // Reuse detected — the token family is compromised. Revoke the session.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: "refresh_token_reuse" },
      });
      await this.events.record("auth.refresh_reuse_detected", ctx, session.userId, { sessionId: session.id });
      throw new UnauthorizedException("Refresh token reuse detected — session revoked");
    }

    const now = new Date();
    if (session.revokedAt || session.expiresAt < now || stored.expiresAt < now) {
      throw new UnauthorizedException("Session expired or revoked");
    }

    const nextToken = randomToken();
    const nextExpiry = new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000);

    await this.prisma.$transaction(async (tx) => {
      const successor = await tx.refreshToken.create({
        data: { sessionId: session.id, tokenHash: sha256(nextToken), expiresAt: nextExpiry },
      });
      const updated = await tx.refreshToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: now, replacedById: successor.id },
      });
      // Concurrent rotation race: only one winner may consume the token.
      if (updated.count !== 1) throw new UnauthorizedException("Refresh token already rotated");
      await tx.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, expiresAt: nextExpiry, ipAddress: ctx.ipAddress ?? session.ipAddress },
      });
    });

    const access = this.signAccess(session.userId, session.id);
    return { ...access, refreshToken: nextToken, sessionId: session.id };
  }
}
