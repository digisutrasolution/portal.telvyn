import { Controller, Get, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { AuthzModule } from "./authz/authz.module";
import { TelecomModule } from "./telecom/telecom.module";
import { FraudModule } from "./fraud/fraud.module";
import { BillingModule } from "./billing/billing.module";
import { TenantContextMiddleware } from "./authz/tenant-context.middleware";

@Controller()
class HealthController {
  @Get("healthz")
  health() {
    return { status: "ok" };
  }
}

@Module({
  imports: [AuthModule, AuthzModule, TelecomModule, FraudModule, BillingModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Seed the tenant-context store for every request (ADR-0004).
    consumer.apply(TenantContextMiddleware).forRoutes("*");
  }
}
