"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { messageFor } from "@/components/auth/auth-message";
import type { Member, TenantRole } from "@/lib/contracts";
import { listRoles, setMemberRoles } from "@/lib/admin/members-actions";

/**
 * Assign a member's roles (Phase 12O-2al). Loads the tenant's assignable roles
 * (system + custom) and pre-checks the member's current roles; Save sends the
 * COMPLETE selected set to PUT /v1/members/{id}/roles (replace semantics) and the
 * parent reloads from the returned member list. Role display names come from the
 * catalog; the server re-checks `member.manage`, validates every role against the
 * tenant, and is authoritative. Removing every role is allowed (an empty set) and
 * is surfaced with a gentle note rather than blocked.
 */
export function MemberRolesDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Member;
  onClose: () => void;
  /** Called with the updated member list returned by the save. */
  onSaved: (members: Member[]) => void;
}) {
  const [roles, setRoles] = React.useState<TenantRole[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(member.roles.map((r) => r.id)));
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError(null);
    listRoles(ac.signal)
      .then((r) => {
        if (!active) return;
        setRoles(r);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setLoadError(messageFor(err));
        setLoading(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const members = await setMemberRoles(member.membershipId, [...selected]);
      onSaved(members);
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  const who = member.user.fullName ?? member.user.email;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogTitle>Manage roles</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          Roles for <span className="font-medium text-ink">{who}</span> in this workspace. Selecting none removes
          all of this member&apos;s roles.
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4">
          {loading ? (
            <p className="text-[13px] text-muted">Loading roles…</p>
          ) : loadError ? (
            <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              Couldn&apos;t load roles: {loadError}
            </p>
          ) : roles.length === 0 ? (
            <p className="text-[13px] text-ink-2">No roles are available to assign.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {roles.map((role) => (
                <li key={role.id}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line px-3 py-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={selected.has(role.id)}
                      onChange={() => toggle(role.id)}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink">{role.name}</span>
                        {role.isSystem && <Badge tone="info">System</Badge>}
                      </span>
                      {role.description && <span className="mt-0.5 block text-[12px] text-muted">{role.description}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {selected.size === 0 && !loading && !loadError && roles.length > 0 && (
            <p className="mt-2 text-[12px] text-warn">No roles selected — saving will remove all of this member&apos;s roles.</p>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending || loading || loadError !== null}>
              {pending ? "Saving…" : "Save roles"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
