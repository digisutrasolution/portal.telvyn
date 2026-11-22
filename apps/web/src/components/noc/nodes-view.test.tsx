import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Node } from "@/lib/contracts";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/telecom/telecom-actions", () => ({
  listNodes: vi.fn(),
  checkNodeHealth: vi.fn(),
  listNodeHealthEvents: vi.fn(),
  attachNodeCredential: vi.fn(),
  detachNodeCredential: vi.fn(),
}));

import { listNodes, checkNodeHealth, listNodeHealthEvents } from "@/lib/telecom/telecom-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { NodesView } from "./nodes-view";

// `telecom.health.read` present so the per-row Check (probe) button renders.
const healthLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "PLATFORM",
  roles: [],
  permissions: ["telecom.read", "telecom.health.read"],
});

// `telecom.manage` present so the per-row Credential button renders (Phase 12O-2bd).
const manageLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "PLATFORM",
  roles: [],
  permissions: ["telecom.read", "telecom.manage"],
});

function renderView(loader: SessionLoader = healthLoader) {
  return render(
    <SessionProvider loader={loader}>
      <NodesView />
    </SessionProvider>,
  );
}

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
    renderView();
    expect(await screen.findByText("node-a")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("zone-1")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    vi.mocked(listNodes).mockResolvedValue([]);
    renderView();
    expect(await screen.findByText("No nodes are configured yet.")).toBeInTheDocument();
  });

  it("surfaces an API error", async () => {
    vi.mocked(listNodes).mockRejectedValue(new ApiError({ title: "Insufficient permissions", status: 403 }));
    renderView();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Insufficient permissions"));
  });

  it("probes a node's health from the Check button and reloads the list", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    vi.mocked(checkNodeHealth).mockResolvedValue({ nodeId: "n1", status: "UNKNOWN", reachability: "UNVERIFIED", detail: "no node liveness probe configured — health unverified", correlationId: "c1", checkedAt: "2026-11-23T00:00:00.000Z" });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Check health of node-a" }));

    await waitFor(() => expect(checkNodeHealth).toHaveBeenCalledWith("n1"));
    // list re-fetched after the probe (mount call + reload)
    await waitFor(() => expect(vi.mocked(listNodes).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hides the Check button without telecom.health.read", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "PLATFORM", roles: [], permissions: ["telecom.read"] }));
    await screen.findByText("node-a");
    expect(screen.queryByRole("button", { name: /Check health of/ })).toBeNull();
  });

  it("opens the health-history dialog from the History button", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    vi.mocked(listNodeHealthEvents).mockResolvedValue({
      items: [{ id: "h1", fromStatus: null, toStatus: "UNKNOWN", reason: "posture unverified", correlationId: "c1", createdAt: "2026-11-20T09:30:00.000Z" }],
      nextCursor: null,
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Health history of node-a" }));

    expect(await screen.findByText(/Health history — node-a/)).toBeInTheDocument();
    await waitFor(() => expect(listNodeHealthEvents).toHaveBeenCalledWith("n1", {}, expect.anything()));
    expect(await screen.findByText("posture unverified")).toBeInTheDocument();
  });

  it("hides the History button without telecom.health.read", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "PLATFORM", roles: [], permissions: ["telecom.read"] }));
    await screen.findByText("node-a");
    expect(screen.queryByRole("button", { name: /Health history of/ })).toBeNull();
  });

  it("shows the Credential button with telecom.manage and opens the dialog", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    renderView(manageLoader);
    fireEvent.click(await screen.findByRole("button", { name: "Manage credential for node-a" }));
    expect(await screen.findByText(/Node-agent credential — node-a/)).toBeInTheDocument();
    expect(screen.getByText(/No credential attached/i)).toBeInTheDocument();
  });

  it("hides the Credential button without telecom.manage (health.read alone doesn't grant it)", async () => {
    vi.mocked(listNodes).mockResolvedValue([node()]);
    renderView(healthLoader); // telecom.read + telecom.health.read, no manage
    await screen.findByText("node-a");
    expect(screen.queryByRole("button", { name: /Manage credential for/ })).toBeNull();
  });
});
