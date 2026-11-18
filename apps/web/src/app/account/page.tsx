import type { Metadata } from "next";
import { MfaSettings } from "@/components/account/mfa-settings";

export const metadata: Metadata = { title: "Account & security" };

/**
 * Account & security — self-service settings for the signed-in user. No module
 * permission (any authenticated member reaches it from the account menu); the
 * API still authorizes every action. Phase 12O-2k ships two-factor management.
 */
export default function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="font-display text-[19px] font-semibold text-ink">Account &amp; security</h1>
        <p className="mt-1 text-[13px] text-muted">Manage how you sign in and protect your account.</p>
      </header>
      <MfaSettings />
    </div>
  );
}
