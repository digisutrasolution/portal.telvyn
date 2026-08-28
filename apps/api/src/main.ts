import "reflect-metadata";
import "dotenv/config"; // load apps/api/.env into process.env before env validation
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { ProblemFilter } from "./common/problem.filter";

export async function createApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const isProd = env.NODE_ENV === "production";
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });

  app.disable("x-powered-by");

  // Security headers (helmet), tuned for a pure JSON API: responses never load
  // scripts/styles/frames, so the CSP is maximally strict. HSTS is production-
  // only so local HTTP dev is never pinned to HTTPS. See docs/SECURITY.md.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'none'"],
        },
      },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
      referrerPolicy: { policy: "no-referrer" },
      crossOriginResourcePolicy: { policy: "same-site" },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      frameguard: { action: "deny" }, // stricter than helmet's SAMEORIGIN default; matches CSP frame-ancestors 'none'
      // helmet default keeps X-Content-Type-Options: nosniff.
    }),
  );
  // Permissions-Policy (helmet does not set it): deny powerful features. The
  // telecom softphone (future WebRTC phase) will re-grant microphone here.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
    next();
  });

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
