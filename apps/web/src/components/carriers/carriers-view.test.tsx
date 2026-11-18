import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Carrier } from "@/lib/contracts";

vi.mock("@/lib/telecom/carriers-actions", () => ({ listCarriers: vi.fn() }));

import { listCarriers } from "@/lib/telecom/carriers-actions";
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

  it("shows the empty state when there are no carriers", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    render(<CarriersView />);
    expect(await screen.findByText(/No carriers are configured yet/i)).toBeInTheDocument();
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
