import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Carrier, HealthEvent } from "@/lib/contracts";

vi.mock("@/lib/telecom/carriers-actions", () => ({ listCarrierHealthEvents: vi.fn() }));

import { listCarrierHealthEvents } from "@/lib/telecom/carriers-actions";
import { CarrierHealthHistoryDialog } from "./carrier-health-history-dialog";

function carrier(overrides: Partial<Carrier> = {}): Carrier {
  return {
    id: "c1",
    scope: "TENANT",
    name: "Acme SIP",
    type: "BIDIRECTIONAL",
    country: "US",
    regionId: null,
    status: "ACTIVE",
    priority: null,
    codecs: [],
    maxCps: null,
    maxConcurrentCalls: null,
    credential: null,
    health: { status: "UNKNOWN", detail: "not yet probed" },
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

function ev(overrides: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: crypto.randomUUID(),
    fromStatus: "UNKNOWN",
    toStatus: "DISABLED",
    reason: "carrier disabled",
    correlationId: "corr-1",
    createdAt: "2026-11-20T09:30:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("CarrierHealthHistoryDialog", () => {
  it("renders the carrier's transitions newest-first with from → to and reason", async () => {
    vi.mocked(listCarrierHealthEvents).mockResolvedValue({
      items: [ev({ fromStatus: null, toStatus: "UNKNOWN", reason: "posture unverified" })],
      nextCursor: null,
    });
    render(<CarrierHealthHistoryDialog carrier={carrier()} onClose={() => {}} />);

    expect(await screen.findByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("posture unverified")).toBeInTheDocument();
    expect(screen.getByText(/Health history — Acme SIP/)).toBeInTheDocument();
    expect(listCarrierHealthEvents).toHaveBeenCalledWith("c1", {}, expect.anything());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the empty state when there are no events", async () => {
    vi.mocked(listCarrierHealthEvents).mockResolvedValue({ items: [], nextCursor: null });
    render(<CarrierHealthHistoryDialog carrier={carrier()} onClose={() => {}} />);
    expect(await screen.findByText(/No health events recorded yet/i)).toBeInTheDocument();
  });

  it("loads more with the cursor and appends the older page", async () => {
    vi.mocked(listCarrierHealthEvents)
      .mockResolvedValueOnce({ items: [ev({ toStatus: "UNKNOWN", reason: "first check" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [ev({ toStatus: "DISABLED", reason: "then disabled" })], nextCursor: null });
    render(<CarrierHealthHistoryDialog carrier={carrier()} onClose={() => {}} />);

    expect(await screen.findByText("first check")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listCarrierHealthEvents).toHaveBeenLastCalledWith("c1", { cursor: "cur-2" }));
    expect(await screen.findByText("then disabled")).toBeInTheDocument();
    expect(screen.getByText("first check")).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listCarrierHealthEvents).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<CarrierHealthHistoryDialog carrier={carrier()} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });
});
