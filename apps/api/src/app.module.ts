import { Controller, Get, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";

@Controller()
class HealthController {
  @Get("healthz")
  health() {
    return { status: "ok" };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
