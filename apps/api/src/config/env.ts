import { z } from "zod";

/** Boundary-validated environment. Fails fast at boot on any missing secret. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3311),
  WEB_ORIGIN: z.string().url().default("http://localhost:3211"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY must be 32 bytes base64"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  MFA_ISSUER: z.string().default("Telvyn"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}
