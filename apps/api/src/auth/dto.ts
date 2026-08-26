import { z } from "zod";

/** Boundary schemas — mirror packages/contracts/openapi/telvyn.v1.yaml. */

export const LoginDto = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(128),
});

export const MfaVerifyDto = z.object({
  mfaToken: z.string().min(10).max(2048),
  code: z.string().trim().min(6).max(32),
});

export const RefreshDto = z.object({
  refreshToken: z.string().min(16).max(512).optional(),
});

export const PasswordResetRequestDto = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

export const PasswordResetConfirmDto = z.object({
  token: z.string().min(16).max(512),
  newPassword: z.string().min(12, "Password must be at least 12 characters").max(128),
});

export const EmailVerifyConfirmDto = z.object({
  token: z.string().min(16).max(512),
});

export const MfaEnableDto = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "6-digit code required"),
});

export const MfaDisableDto = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32),
});

export type LoginInput = z.infer<typeof LoginDto>;
export type MfaVerifyInput = z.infer<typeof MfaVerifyDto>;
export type RefreshInput = z.infer<typeof RefreshDto>;
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestDto>;
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmDto>;
export type EmailVerifyConfirmInput = z.infer<typeof EmailVerifyConfirmDto>;
export type MfaEnableInput = z.infer<typeof MfaEnableDto>;
export type MfaDisableInput = z.infer<typeof MfaDisableDto>;
