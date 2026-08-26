import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { TokenService, type AccessClaims } from "./token.service";
import { AuthService } from "./auth.service";

export interface AuthedRequest extends Request {
  auth: AccessClaims;
}

/**
 * Bearer access-token guard with live-session check: a revoked session's
 * access tokens die immediately (revocation), not at JWT expiry.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Missing bearer token");

    const claims = this.tokens.verifyAccess(header.slice(7));
    if (!(await this.auth.isSessionLive(claims.sid))) {
      throw new UnauthorizedException("Session revoked or expired");
    }
    req.auth = claims;
    return true;
  }
}

/** Injects the verified access claims into a handler parameter. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessClaims => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().auth;
});
