import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { loadEnv } from "@/config/env";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { AuthService } from "./auth.service";
import { TokenService, type IssuedTokens } from "./token.service";
import { MfaService } from "./mfa.service";
import { AccountFlowsService } from "./account-flows.service";
import { SecurityEventsService } from "./security-events.service";
import { RateLimitService, RATE_RULES } from "./rate-limit.service";
import { Auth, JwtAuthGuard } from "./jwt-auth.guard";
import type { AccessClaims } from "./token.service";
import {
  LoginDto,
  MfaVerifyDto,
  RefreshDto,
  PasswordResetRequestDto,
  PasswordResetConfirmDto,
  EmailVerifyConfirmDto,
  MfaEnableDto,
  MfaDisableDto,
  type LoginInput,
  type MfaVerifyInput,
  type RefreshInput,
  type PasswordResetRequestInput,
  type PasswordResetConfirmInput,
  type EmailVerifyConfirmInput,
  type MfaEnableInput,
  type MfaDisableInput,
} from "./dto";

const REFRESH_COOKIE = "tv_refresh";

/**
 * Auth endpoints per packages/contracts/openapi/telvyn.v1.yaml.
 * Browser clients get the refresh token ONLY as an httpOnly SameSite=Strict
 * cookie scoped to /v1/auth. Non-browser clients opt into body transport with
 * the `x-token-transport: body` header (contract: refreshToken optional).
 */
@Controller("v1/auth")
export class AuthController {
  private readonly env = loadEnv();

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly flows: AccountFlowsService,
    private readonly events: SecurityEventsService,
    private readonly rate: RateLimitService,
  ) {}

  // ---------- login / mfa / refresh / logout ----------

  @Post("login")
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginDto)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = requestContext(req);
    await this.rate.consume(RATE_RULES.loginIp, ctx.ipAddress ?? "unknown");
    await this.rate.consume(RATE_RULES.loginEmail, body.email);

    const outcome = await this.auth.login(body.email, body.password, ctx);
    if (outcome.kind === "mfa") return { mfaRequired: true, mfaToken: outcome.mfaToken };

    await this.rate.reset(RATE_RULES.loginEmail.bucket, body.email);
    return this.deliverTokens(outcome.tokens, req, res);
  }

  @Post("mfa/verify")
  @HttpCode(200)
  async mfaVerify(@Body(new ZodPipe(MfaVerifyDto)) body: MfaVerifyInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = requestContext(req);
    await this.rate.consume(RATE_RULES.mfaVerify, ctx.ipAddress ?? "unknown");
    const tokens = await this.auth.completeMfaLogin(body.mfaToken, body.code, ctx);
    return this.deliverTokens(tokens, req, res);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body(new ZodPipe(RefreshDto)) body: RefreshInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = requestContext(req);
    await this.rate.consume(RATE_RULES.refresh, ctx.ipAddress ?? "unknown");
    const presented = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? body.refreshToken;
    if (!presented) throw new UnauthorizedException("Missing refresh token");
    const tokens = await this.tokens.rotate(presented, ctx);
    return this.deliverTokens(tokens, req, res);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@Auth() auth: AccessClaims, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeSession(auth.sub, auth.sid, "logout", requestContext(req));
    this.clearRefreshCookie(res);
  }

  @Post("logout-all")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logoutAll(@Auth() auth: AccessClaims, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAllSessions(auth.sub, requestContext(req));
    this.clearRefreshCookie(res);
  }

  // ---------- identity / sessions / history ----------

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Auth() auth: AccessClaims) {
    return this.auth.me(auth.sub);
  }

  @Get("sessions")
  @UseGuards(JwtAuthGuard)
  sessions(@Auth() auth: AccessClaims) {
    return this.auth.listSessions(auth.sub, auth.sid);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async revokeSession(@Auth() auth: AccessClaims, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.auth.revokeSession(auth.sub, id, "revoked_by_user", requestContext(req));
  }

  @Get("login-history")
  @UseGuards(JwtAuthGuard)
  loginHistory(@Auth() auth: AccessClaims) {
    return this.events.listLoginHistory(auth.sub);
  }

  @Get("security-events")
  @UseGuards(JwtAuthGuard)
  securityEvents(@Auth() auth: AccessClaims) {
    return this.events.listSecurityEvents(auth.sub);
  }

  // ---------- password reset / email verification ----------

  @Post("password-reset/request")
  @HttpCode(202)
  async passwordResetRequest(@Body(new ZodPipe(PasswordResetRequestDto)) body: PasswordResetRequestInput, @Req() req: Request) {
    const ctx = requestContext(req);
    await this.rate.consume(RATE_RULES.resetRequest, ctx.ipAddress ?? "unknown");
    await this.flows.requestPasswordReset(body.email, ctx);
    return { accepted: true };
  }

  @Post("password-reset/confirm")
  @HttpCode(204)
  async passwordResetConfirm(@Body(new ZodPipe(PasswordResetConfirmDto)) body: PasswordResetConfirmInput, @Req() req: Request) {
    const ctx = requestContext(req);
    await this.rate.consume(RATE_RULES.resetConfirm, ctx.ipAddress ?? "unknown");
    await this.flows.confirmPasswordReset(body.token, body.newPassword, ctx);
  }

  @Post("email-verification/request")
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  async emailVerificationRequest(@Auth() auth: AccessClaims, @Req() req: Request) {
    await this.flows.requestEmailVerification(auth.sub, requestContext(req));
    return { accepted: true };
  }

  @Post("email-verification/confirm")
  @HttpCode(204)
  async emailVerificationConfirm(@Body(new ZodPipe(EmailVerifyConfirmDto)) body: EmailVerifyConfirmInput, @Req() req: Request) {
    const ctx = requestContext(req);
    await this.rate.consume(RATE_RULES.emailVerify, ctx.ipAddress ?? "unknown");
    await this.flows.confirmEmailVerification(body.token, ctx);
  }

  // ---------- MFA lifecycle (authed; disable is step-up) ----------

  @Post("mfa/enroll")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async mfaEnroll(@Auth() auth: AccessClaims, @Req() req: Request) {
    const me = await this.auth.me(auth.sub);
    const result = await this.mfa.enroll(auth.sub, me.email);
    await this.events.record("auth.mfa_enroll_started", requestContext(req), auth.sub);
    return result;
  }

  @Post("mfa/enable")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async mfaEnable(@Auth() auth: AccessClaims, @Body(new ZodPipe(MfaEnableDto)) body: MfaEnableInput, @Req() req: Request) {
    const result = await this.mfa.enable(auth.sub, body.code);
    await this.events.record("auth.mfa_enabled", requestContext(req), auth.sub);
    return result;
  }

  @Post("mfa/disable")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async mfaDisable(@Auth() auth: AccessClaims, @Body(new ZodPipe(MfaDisableDto)) body: MfaDisableInput, @Req() req: Request) {
    const ctx = requestContext(req);
    // Step-up: current password AND a valid TOTP/recovery code.
    const passwordOk = await this.auth.verifyPassword(auth.sub, body.password);
    const codeOk = passwordOk && (await this.mfa.verifyCode(auth.sub, body.code));
    if (!passwordOk || !codeOk) throw new UnauthorizedException("Step-up verification failed");
    await this.mfa.disable(auth.sub);
    await this.events.record("auth.mfa_disabled", ctx, auth.sub);
  }

  // ---------- helpers ----------

  private deliverTokens(tokens: IssuedTokens, req: Request, res: Response) {
    const bodyTransport = req.headers["x-token-transport"] === "body";
    if (!bodyTransport) {
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        httpOnly: true,
        secure: this.env.COOKIE_SECURE,
        sameSite: "strict",
        path: "/v1/auth",
        maxAge: this.env.REFRESH_TTL_DAYS * 86_400_000,
      });
    }
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      ...(bodyTransport ? { refreshToken: tokens.refreshToken } : {}),
    };
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
  }
}
