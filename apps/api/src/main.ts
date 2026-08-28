import "reflect-metadata";
import "dotenv/config"; // load apps/api/.env into process.env before env validation
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { ProblemFilter } from "./common/problem.filter";

export async function createApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });

  app.disable("x-powered-by");
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemFilter());
  app.enableCors({
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Token-Transport", "Idempotency-Key"],
  });
  app.getHttpAdapter().getInstance().set("etag", false);
  return app;
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.API_PORT);
  console.log(`telvyn-api listening on :${env.API_PORT}`);
}

if (require.main === module) {
  void bootstrap();
}
