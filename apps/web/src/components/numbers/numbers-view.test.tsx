import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Did } from "@/lib/contracts";

vi.mock("@/lib/telecom/dids-actions", () => ({ listDids: vi.fn(), getDid: vi.fn() }));

import { getDid, listDids } from "@/lib/telecom/dids-actions";
import { NumbersView } from "./numbers-view";

function did(overrides: Partial<Did> = {}): Did {
  return {
    id: crypto.randomUUID(),
    e164: "+14155550100",
    country: "US",
    status: "ACTIVE",
    carrierId: null,
    sipTrunkId: null,
    routingProfileId: null,
    regionId: null,
    assignedAt: null,
    health: { status: "UNKNOWN", detail: "no health check configured" },
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("NumbersView", () => {
  it("renders the first page with number, status and honest UNKNOWN health", async () => {
    vi.mocked(listDids).mockResolvedValue({
      items: [
        did({ e164: "+14155550100", status: "ACTIVE", assignedAt: "2026-10-01T12:00:00.000Z", carrierId: "c0ffee00-0000-0000-0000-000000000000" }),
        did({ e164: "+442071234567", status: "AVAILABLE", country: "GB" }),
      ],
      nextCursor: null,
    });
    render(<NumbersView />);

    expect(await screen.findByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("+442071234567")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("AVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument(); // assignedAt date-only
    expect(screen.getByText("c0ffee00")).toBeInTheDocument(); // carrier short ref
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the number fetched by id", async () => {
    const routingProfileId = "11111111-2222-3333-4444-555555555555";
    const row = did({ e164: "+14155550100" });
    vi.mocked(listDids).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getDid).mockResolvedValue(did({ id: row.id, e164: "+14155550100", routingProfileId }));
    render(<NumbersView />);

    fireEvent.click(await screen.findByRole("button", { name: "View +14155550100" }));

    await waitFor(() => expect(getDid).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only fields appear in the drawer (full related-resource id, not the list's short ref).
    expect(await screen.findByText("Routing profile")).toBeInTheDocument();
    expect(screen.getByText(routingProfileId)).toBeInTheDocument();
  });

  it("shows the empty state when there are no numbers", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [], nextCursor: null });
    render(<NumbersView />);
    expect(await screen.findByText(/No numbers in your inventory yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [did({ e164: "+14155550100" })], nextCursor: null });
    render(<NumbersView />);
    expect(await screen.findByText("+14155550100")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "AVAILABLE" } });
    await waitFor(() => expect(listDids).toHaveBeenLastCalledWith({ status: "AVAILABLE" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [did({ e164: "+14155550100" })], nextCursor: null });
    render(<NumbersView />);
    const box = await screen.findByRole("searchbox", { name: "Search numbers" });

    fireEvent.change(box, { target: { value: "+1415" } });
    await waitFor(() => expect(listDids).toHaveBeenLastCalledWith({ q: "+1415" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listDids)
      .mockResolvedValueOnce({ items: [did({ e164: "+14155550100" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<NumbersView />);
    expect(await screen.findByText("+14155550100")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "RELEASED" } });
    expect(await screen.findByText(/No numbers match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listDids).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<NumbersView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listDids)
      .mockResolvedValueOnce({ items: [did({ e164: "+1111111111" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [did({ e164: "+2222222222" })], nextCursor: null });
    render(<NumbersView />);

    expect(await screen.findByText("+1111111111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listDids).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("+2222222222")).toBeInTheDocument();
    expect(screen.getByText("+1111111111")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
