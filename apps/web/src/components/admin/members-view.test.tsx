import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Member, TenantRole } from "@/lib/contracts";

vi.mock("@/lib/admin/members-actions", () => ({
  listMembers: vi.fn(),
  listRoles: vi.fn(),
  setMemberRoles: vi.fn(),
}));

import { listMembers, listRoles, setMemberRoles } from "@/lib/admin/members-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { MembersView } from "./members-view";

// `member.manage` + `role.read` so the "Manage roles" affordance and role picker work.
const allPermsLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "RESELLER",
  roles: [],
  permissions: ["member.read", "member.manage", "role.read"],
});

function renderView(loader: SessionLoader = allPermsLoader) {
  return render(
    <SessionProvider loader={loader}>
      <MembersView />
    </SessionProvider>,
  );
}

function member(overrides: Partial<Member> = {}): Member {
  return {
    membershipId: crypto.randomUUID(),
    status: "ACTIVE",
    user: { id: crypto.randomUUID(), email: "ada@example.com", fullName: "Ada Lovelace", status: "ACTIVE" },
    roles: [{ id: crypto.randomUUID(), key: "owner", name: "Owner" }],
    ...overrides,
  };
}

function role(overrides: Partial<TenantRole> = {}): TenantRole {
  return {
    id: crypto.randomUUID(),
    key: "custom",
    name: "Custom",
    description: null,
    isSystem: false,
    permissions: [],
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("MembersView", () => {
  it("renders the members with identity, statuses and role names", async () => {
    vi.mocked(listMembers).mockResolvedValue([
      member({ user: { id: crypto.randomUUID(), email: "ada@example.com", fullName: "Ada Lovelace", status: "ACTIVE" }, roles: [{ id: crypto.randomUUID(), key: "owner", name: "Owner" }] }),
      member({ status: "SUSPENDED", user: { id: crypto.randomUUID(), email: "pending@example.com", fullName: null, status: "INVITED" }, roles: [] }),
    ]);
    renderView();

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("INVITED")).toBeInTheDocument();
    expect(screen.getByText("SUSPENDED")).toBeInTheDocument();
  });

  it("shows the empty state when the tenant has no members", async () => {
    vi.mocked(listMembers).mockResolvedValue([]);
    renderView();
    expect(await screen.findByText(/No members in this workspace yet/i)).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listMembers).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    renderView();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Forbidden"));
  });

  it("assigns roles via the Manage-roles dialog (replace set) and reloads the list", async () => {
    const ownerId = crypto.randomUUID();
    const billingId = crypto.randomUUID();
    const row = member({ roles: [{ id: ownerId, key: "owner", name: "Owner" }] });
    vi.mocked(listMembers).mockResolvedValue([row]);
    vi.mocked(listRoles).mockResolvedValue([
      role({ id: ownerId, key: "owner", name: "Owner", isSystem: true }),
      role({ id: billingId, key: "billing", name: "Billing", description: "Manage billing" }),
    ]);
    vi.mocked(setMemberRoles).mockResolvedValue([row]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /Manage roles for Ada Lovelace/ }));
    // Picker loads with the current role (Owner) pre-checked; add Billing.
    fireEvent.click(await screen.findByText("Billing"));
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() => expect(setMemberRoles).toHaveBeenCalledTimes(1));
    const [id, roleIds] = vi.mocked(setMemberRoles).mock.calls[0];
    expect(id).toBe(row.membershipId);
    expect(new Set(roleIds)).toEqual(new Set([ownerId, billingId])); // existing + newly-checked
    // list reloaded after the save (first-load call + reload)
    await waitFor(() => expect(vi.mocked(listMembers).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hides Manage roles without member.manage permission", async () => {
    vi.mocked(listMembers).mockResolvedValue([member({ user: { id: crypto.randomUUID(), email: "ada@example.com", fullName: "Ada Lovelace", status: "ACTIVE" }, roles: [] })]);
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["member.read"] }));
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /Manage roles/ })).toBeNull();
  });
});
