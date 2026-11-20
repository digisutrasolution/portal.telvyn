"use client";

import * as React from "react";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Member } from "@/lib/contracts";
import { listMembers } from "@/lib/admin/members-actions";
import { useResource } from "@/lib/use-resource";

type Tone = "ok" | "info" | "warn" | "danger" | "frozen" | "neutral";
const MEMBERSHIP_TONE: Record<Member["status"], Tone> = { ACTIVE: "ok", SUSPENDED: "warn" };
const ACCOUNT_TONE: Record<Member["user"]["status"], Tone> = { ACTIVE: "ok", INVITED: "info", DISABLED: "neutral" };

/**
 * Read-only members list for the current tenant (Phase 12O-2ad). Shows every
 * member of the session's own tenant — identity, membership status, account
 * status, and the roles assigned in this tenant. The server auto-scopes to the
 * session's tenant (a foreign tenant's members are never returned) and the
 * route/nav gate on `member.read` (ADR-0017); the API re-checks every request.
 * No secrets appear. A tenant's team is small, so the full list loads at once
 * (no pagination). Member management (invite / role changes) is a later phase.
 */
export function MembersView() {
  const load = React.useCallback((signal: AbortSignal) => listMembers(signal), []);
  const { data, loading, error, reload } = useResource<Member[]>(load);
  const members = data ?? [];

  return (
    <section aria-labelledby="members-heading">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 id="members-heading" className="font-display text-[19px] font-semibold text-ink">Members</h1>
          <p className="text-[13px] text-muted">People with access to your workspace and the roles they hold here.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>Refresh</Button>
      </header>

      {loading ? (
        <p className="text-[13px] text-muted">Loading members…</p>
      ) : error ? (
        <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">{error}</div>
      ) : members.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1">
          <Users aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">No members in this workspace yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Email</th>
                <th scope="col" className="px-3 py-2 font-semibold">Membership</th>
                <th scope="col" className="px-3 py-2 font-semibold">Account</th>
                <th scope="col" className="px-3 py-2 font-semibold">Roles</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium text-ink">{m.user.fullName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{m.user.email}</td>
                  <td className="px-3 py-2"><Badge tone={MEMBERSHIP_TONE[m.status]}>{m.status}</Badge></td>
                  <td className="px-3 py-2"><Badge tone={ACCOUNT_TONE[m.user.status]}>{m.user.status}</Badge></td>
                  <td className="px-3 py-2">
                    {m.roles.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {m.roles.map((r) => (
                          <Badge key={r.id} tone="neutral">{r.name}</Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
