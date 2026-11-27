import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "@/config/env";
import { PrismaService } from "@/infra/prisma.service";
import { RedisService } from "@/infra/redis.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";
import { MfaService } from "./mfa.service";
import { AccountFlowsService } from "./account-flows.service";
import { SecurityEventsService } from "./security-events.service";
import { RateLimitService } from "./rate-limit.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { StepUpService } from "./step-up.service";
import { StepUpController } from "./step-up.controller";

@Module({
  imports: [
    JwtModule.register({
      secret: loadEnv().JWT_ACCESS_SECRET,
      signOptions: { issuer: "telvyn-api", audience: "telvyn-portal" },
      verifyOptions: { issuer: "telvyn-api", audience: "telvyn-portal" },
    }),
  ],
  controllers: [AuthController, StepUpController],
  providers: [
    PrismaService,
    RedisService,
    AuthService,
    TokenService,
    MfaService,
    AccountFlowsService,
    SecurityEventsService,
    RateLimitService,
    JwtAuthGuard,
    // Financial step-up (Phase 13-2B S1, BA-15); issued via StepUpController (S5).
    StepUpService,
  ],
  exports: [JwtAuthGuard, AuthService, TokenService, StepUpService],
})
export class AuthModule {}
