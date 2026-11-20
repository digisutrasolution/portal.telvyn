import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Carrier } from "@/lib/contracts";

vi.mock("@/lib/telecom/carriers-actions", () => ({ listCarriers: vi.fn(), getCarrier: vi.fn() }));

import { getCarrier, listCarriers } from "@/lib/telecom/carriers-actions";
import { CarriersView } from "./carriers-view";

function carrier(overrides: Partial<Carrier> = {}): Carrier {
  return {
    id: crypto.randomUUID(),
    scope: "TENANT",
    name: "Acme SIP",
    type: "BIDIRECTIONAL",
    country: "US",
    regionId: null,
    status: "ACTIVE",
    priority: null,
    codecs: ["OPUS", "PCMU"],
    maxCps: null,
    maxConcurrentCalls: null,
    credential: null,
    health: { status: "UNKNOWN", detail: "no health check configured" },
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("CarriersView", () => {
  it("renders the first page with scope and honest UNKNOWN health", async () => {
    vi.mocked(listCarriers).mockResolvedValue({
      items: [carrier({ name: "Acme SIP", scope: "TENANT" }), carrier({ name: "Globe Telecom", scope: "SYSTEM" })],
      nextCursor: null,
    });
    render(<CarriersView />);

    expect(await screen.findByText("Acme SIP")).toBeInTheDocument();
    expect(screen.getByText("Globe Telecom")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM")).toBeInTheDocument();
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    // No next page → no Load more.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the carrier fetched by id", async () => {
    const row = carrier({ name: "Acme SIP", maxConcurrentCalls: 500 });
    vi.mocked(listCarriers).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getCarrier).mockResolvedValue(carrier({ id: row.id, name: "Acme SIP", maxConcurrentCalls: 500, priority: 10 }));
    render(<CarriersView />);

    fireEvent.click(await screen.findByRole("button", { name: "View Acme SIP" }));

    await waitFor(() => expect(getCarrier).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only fields appear in the drawer.
    expect(await screen.findByText("Max concurrent calls")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows the empty state when there are no carriers", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    render(<CarriersView />);
    expect(await screen.findByText(/No carriers are configured yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    render(<CarriersView />);
    expect(await screen.findByText("Acme SIP")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(listCarriers).toHaveBeenLastCalledWith({ status: "ACTIVE" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    render(<CarriersView />);
    const box = await screen.findByRole("searchbox", { name: "Search carriers" });

    fireEvent.change(box, { target: { value: "globe" } });
    await waitFor(() => expect(listCarriers).toHaveBeenLastCalledWith({ q: "globe" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listCarriers)
      .mockResolvedValueOnce({ items: [carrier({ name: "Acme SIP" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<CarriersView />);
    expect(await screen.findByText("Acme SIP")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "DISABLED" } });
    expect(await screen.findByText(/No carriers match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listCarriers).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<CarriersView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listCarriers)
      .mockResolvedValueOnce({ items: [carrier({ name: "Page One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [carrier({ name: "Page Two" })], nextCursor: null });
    render(<CarriersView />);

    expect(await screen.findByText("Page One")).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(more);

    await waitFor(() => expect(listCarriers).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Page Two")).toBeInTheDocument();
    expect(screen.getByText("Page One")).toBeInTheDocument(); // still there (appended)
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull(); // exhausted
  });
});
