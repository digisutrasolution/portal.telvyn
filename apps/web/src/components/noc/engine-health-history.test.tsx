import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { HealthEvent } from "@/lib/contracts";

vi.mock("@/lib/telecom/telecom-actions", () => ({ listEngineHealthEvents: vi.fn() }));

import { listEngineHealthEvents } from "@/lib/telecom/telecom-actions";
import { EngineHealthHistory } from "./engine-health-history";

function ev(overrides: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: crypto.randomUUID(),
    fromStatus: "UNKNOWN",
    toStatus: "HEALTHY",
    reason: "reachable",
    correlationId: "corr-1",
    createdAt: "2026-11-20T09:30:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("EngineHealthHistory", () => {
  it("renders the transitions newest-first with from → to and reason", async () => {
    vi.mocked(listEngineHealthEvents).mockResolvedValue({
      items: [ev({ fromStatus: "UNKNOWN", toStatus: "HEALTHY", reason: "reachable" })],
      nextCursor: null,
    });
    render(<EngineHealthHistory engineId="eng-1" />);

    expect(await screen.findByText("HEALTHY")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument(); // the fromStatus
    expect(screen.getByText("reachable")).toBeInTheDocument();
    expect(listEngineHealthEvents).toHaveBeenCalledWith("eng-1", {}, expect.anything());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the empty state when there are no events", async () => {
    vi.mocked(listEngineHealthEvents).mockResolvedValue({ items: [], nextCursor: null });
    render(<EngineHealthHistory engineId="eng-1" />);
    expect(await screen.findByText(/No health events recorded yet/i)).toBeInTheDocument();
  });

  it("loads more with the cursor and appends the older page", async () => {
    vi.mocked(listEngineHealthEvents)
      .mockResolvedValueOnce({ items: [ev({ toStatus: "HEALTHY", reason: "now healthy" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [ev({ toStatus: "UNHEALTHY", reason: "was down" })], nextCursor: null });
    render(<EngineHealthHistory engineId="eng-1" />);

    expect(await screen.findByText("now healthy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listEngineHealthEvents).toHaveBeenLastCalledWith("eng-1", { cursor: "cur-2" }));
    expect(await screen.findByText("was down")).toBeInTheDocument();
    expect(screen.getByText("now healthy")).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listEngineHealthEvents).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<EngineHealthHistory engineId="eng-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });
});
