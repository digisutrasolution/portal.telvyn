import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { HealthEvent, Node } from "@/lib/contracts";

vi.mock("@/lib/telecom/telecom-actions", () => ({ listNodeHealthEvents: vi.fn() }));

import { listNodeHealthEvents } from "@/lib/telecom/telecom-actions";
import { NodeHealthHistoryDialog } from "./node-health-history-dialog";

function node(overrides: Partial<Node> = {}): Node {
  return {
    id: "n1",
    name: "node-a",
    engineId: "e1",
    regionId: null,
    zone: "zone-1",
    environment: "PRODUCTION",
    hostRef: null,
    status: "ACTIVE",
    version: "1.0",
    maxCps: null,
    maxConcurrentCalls: null,
    health: { status: "UNKNOWN", latencyMs: null, lastHeartbeatAt: null },
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

function ev(overrides: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: crypto.randomUUID(),
    fromStatus: "UNKNOWN",
    toStatus: "DISABLED",
    reason: "node disabled",
    correlationId: "corr-1",
    createdAt: "2026-11-20T09:30:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("NodeHealthHistoryDialog", () => {
  it("renders the node's transitions newest-first with from → to and reason", async () => {
    vi.mocked(listNodeHealthEvents).mockResolvedValue({
      items: [ev({ fromStatus: null, toStatus: "UNKNOWN", reason: "posture unverified" })],
      nextCursor: null,
    });
    render(<NodeHealthHistoryDialog node={node()} onClose={() => {}} />);

    expect(await screen.findByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("posture unverified")).toBeInTheDocument();
    expect(screen.getByText(/Health history — node-a/)).toBeInTheDocument();
    expect(listNodeHealthEvents).toHaveBeenCalledWith("n1", {}, expect.anything());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the empty state when there are no events", async () => {
    vi.mocked(listNodeHealthEvents).mockResolvedValue({ items: [], nextCursor: null });
    render(<NodeHealthHistoryDialog node={node()} onClose={() => {}} />);
    expect(await screen.findByText(/No health events recorded yet/i)).toBeInTheDocument();
  });

  it("loads more with the cursor and appends the older page", async () => {
    vi.mocked(listNodeHealthEvents)
      .mockResolvedValueOnce({ items: [ev({ toStatus: "UNKNOWN", reason: "first check" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [ev({ toStatus: "DISABLED", reason: "then disabled" })], nextCursor: null });
    render(<NodeHealthHistoryDialog node={node()} onClose={() => {}} />);

    expect(await screen.findByText("first check")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listNodeHealthEvents).toHaveBeenLastCalledWith("n1", { cursor: "cur-2" }));
    expect(await screen.findByText("then disabled")).toBeInTheDocument();
    expect(screen.getByText("first check")).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listNodeHealthEvents).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<NodeHealthHistoryDialog node={node()} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });
});
