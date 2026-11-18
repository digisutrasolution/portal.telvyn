import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Node } from "@/lib/contracts";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/telecom/telecom-actions", () => ({ listNodes: vi.fn() }));

import { listNodes } from "@/lib/telecom/telecom-actions";
import { NodesView } from "./nodes-view";

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

afterEach(() => vi.clearAllMocks());

describe("NodesView", () => {
  it("renders a row per node with its status and heartbeat health", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    render(<NodesView />);
    expect(await screen.findByText("node-a")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("zone-1")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    vi.mocked(listNodes).mockResolvedValue([]);
    render(<NodesView />);
    expect(await screen.findByText("No nodes are configured yet.")).toBeInTheDocument();
  });

  it("surfaces an API error", async () => {
    vi.mocked(listNodes).mockRejectedValue(new ApiError({ title: "Insufficient permissions", status: 403 }));
    render(<NodesView />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Insufficient permissions"));
  });
});
