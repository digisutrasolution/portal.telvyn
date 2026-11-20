import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Member } from "@/lib/contracts";

vi.mock("@/lib/admin/members-actions", () => ({ listMembers: vi.fn() }));

import { listMembers } from "@/lib/admin/members-actions";
import { MembersView } from "./members-view";

function member(overrides: Partial<Member> = {}): Member {
  return {
    membershipId: crypto.randomUUID(),
    status: "ACTIVE",
    user: { id: crypto.randomUUID(), email: "ada@example.com", fullName: "Ada Lovelace", status: "ACTIVE" },
    roles: [{ id: crypto.randomUUID(), key: "owner", name: "Owner" }],
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
    render(<MembersView />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    // The invited, role-less, suspended member: null name → "—", INVITED + SUSPENDED badges.
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("INVITED")).toBeInTheDocument();
    expect(screen.getByText("SUSPENDED")).toBeInTheDocument();
  });

  it("shows the empty state when the tenant has no members", async () => {
    vi.mocked(listMembers).mockResolvedValue([]);
    render(<MembersView />);
    expect(await screen.findByText(/No members in this workspace yet/i)).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listMembers).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<MembersView />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Forbidden"));
  });
});
