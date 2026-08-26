import { Controller, Get, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { AuthzModule } from "./authz/authz.module";

@Controller()
class HealthController {
  @Get("healthz")
  health() {
    return { status: "ok" };
  }
}

@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [HealthController],
})
export class AppModule {}
