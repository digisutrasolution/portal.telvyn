import type { Metadata } from "next";
import { ResetPasswordScreen } from "@/components/auth/reset-password-screen";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordScreen token={token} />;
}
