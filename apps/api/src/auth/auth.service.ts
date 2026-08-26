import { Injectable, NotFoundException, UnauthorizedException, HttpException, HttpStatus } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "@/infra/prisma.service";
import { lockoutSeconds } from "@/common/lockout.policy";
import type { RequestContext } from "@/common/request-context";
import { ARGON2_OPTIONS } from "./account-flows.service";
import { MfaService } from "./mfa.service";
import { SecurityEventsService } from "./security-events.service";
import { TokenService, type IssuedTokens } from "./token.service";

export type LoginOutcome = { kind: "tokens"; tokens: IssuedTokens } | { kind: "mfa"; mfaToken: string };

/** Login orchestration: lockout → argon2 verify → MFA gate → session issue. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly events: SecurityEventsService,
  ) {}

  /**
   * Resolve the active tenant for a session (ADR-0004) — server-side only.
   * Prefers the user's primary tenant when it has an active membership;
   * otherwise the first active membership; null if the user belongs to none.
   */
  private async resolveActiveTenant(userId: string): Promise<string | null> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: "ACTIVE", deletedAt: null, tenant: { status: "ACTIVE", deletedAt: null } },
      select: { tenantId: true },
      orderBy: { createdAt: "asc" },
    });
    if (memberships.length === 0) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
    if (user?.tenantId && memberships.some((m) => m.tenantId === user.tenantId)) return user.tenantId;
    return memberships[0].tenantId;
  }

  async login(email: string, password: string, ctx: RequestContext): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const fail = async (reason: string, userId?: string | null): Promise<never> => {
      await this.events.recordLoginAttempt({ emailTried: email, userId, success: false, failureReason: reason, ctx });
      // Generic message — no account enumeration, no reason leakage.
      throw new UnauthorizedException("Invalid email or password");
    };

    if (!user || user.deletedAt) {
      // Constant-ish time: burn an argon2 verification against a dummy hash.
      await argon2.verify(DUMMY_HASH, password).catch(() => false);
      return fail("unknown_email");
    }
    if (user.status === "DISABLED") return fail("disabled", user.id);

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.events.recordLoginAttempt({ emailTried: email, userId: user.id, success: false, failureReason: "locked", ctx });
      throw new HttpException("Account temporarily locked — try again later", HttpStatus.LOCKED);
    }

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) {
      const failedLogins = user.failedLogins + 1;
      const lockSec = lockoutSeconds(failedLogins);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins,
          lockedUntil: lockSec > 0 ? new Date(Date.now() + lockSec * 1000) : null,
        },
      });
      if (lockSec > 0) await this.events.record("auth.account_locked", ctx, user.id, { failedLogins, lockSec });
      return fail("bad_password", user.id);
    }

    // Success path: reset counters; opportunistic rehash if params changed.
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    if (argon2.needsRehash(user.passwordHash, ARGON2_OPTIONS)) {
      const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    }

    if (user.mfaEnabled) {
      await this.events.record("auth.mfa_challenged", ctx, user.id);
      return { kind: "mfa", mfaToken: this.tokens.signMfaToken(user.id) };
    }

    const tenantId = await this.resolveActiveTenant(user.id);
    const tokens = await this.tokens.createSession(user.id, ctx, tenantId);
    await this.events.recordLoginAttempt({ emailTried: email, userId: user.id, success: true, ctx });
    await this.events.record("auth.login", ctx, user.id, { sessionId: tokens.sessionId, tenantId });
    return { kind: "tokens", tokens };
  }

  async completeMfaLogin(mfaToken: string, code: string, ctx: RequestContext): Promise<IssuedTokens> {
    const userId = this.tokens.verifyMfaToken(mfaToken);
    const ok = await this.mfa.verifyCode(userId, code);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!ok) {
      await this.events.recordLoginAttempt({ emailTried: user.email, userId, success: false, failureReason: "bad_mfa_code", ctx });
      throw new UnauthorizedException("Invalid code");
    }
    const tenantId = await this.resolveActiveTenant(userId);
    const tokens = await this.tokens.createSession(userId, ctx, tenantId);
    await this.events.recordLoginAttempt({ emailTried: user.email, userId, success: true, ctx });
    await this.events.record("auth.login_mfa", ctx, userId, { sessionId: tokens.sessionId, tenantId });
    return tokens;
  }

  /** Step-up check for sensitive operations (e.g. MFA disable). */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return argon2.verify(user.passwordHash, password).catch(() => false);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, mfaEnabled: true, emailVerifiedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      mfaEnabled: user.mfaEnabled,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, deviceLabel: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string, reason: string, ctx: RequestContext): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (result.count === 0) throw new NotFoundException("Session not found");
    await this.events.record("auth.session_revoked", ctx, userId, { sessionId, reason });
  }

  async revokeAllSessions(userId: string, ctx: RequestContext): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "logout_all" },
    });
    await this.events.record("auth.logout_all", ctx, userId);
  }

  /** Session liveness check used by the access-token guard (revocation support). */
  async isSessionLive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return !!session && !session.revokedAt && session.expiresAt > new Date();
  }
}

// argon2id digest of an unknowable random value — used to equalize timing for unknown emails.
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Wn2x0mLqQpDpFyBBHRWzWLKjLXbLcJIC5c8h5Oe9SVM";
