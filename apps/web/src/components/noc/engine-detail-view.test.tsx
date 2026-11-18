import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Engine, EngineStatus } from "@/lib/contracts";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/telecom/telecom-actions", () => ({ getEngine: vi.fn(), getEngineStatus: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { getEngine, getEngineStatus } from "@/lib/telecom/telecom-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { EngineDetailView } from "./engine-detail-view";

// No telecom.* permissions → the mutating EngineActions renders nothing, keeping
// these tests focused on the read-only detail. Action behavior lives in
// engine-actions.test.tsx.
const noPermsLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "PLATFORM",
  roles: [],
  permissions: [],
});

function renderDetail() {
  return render(
    <SessionProvider loader={noPermsLoader}>
      <EngineDetailView engineId="eng-1" />
    </SessionProvider>,
  );
}

function engine(): Engine {
  return {
    id: "eng-1",
    name: "kamailio-vps",
    type: "KAMAILIO",
    provider: null,
    version: "6.1.5",
    endpoint: null,
    credentialId: null,
    environment: "PRODUCTION",
    status: "ACTIVE",
    regionId: null,
    capabilities: [],
    softwareCapabilities: { health: true, routing: true, registration: false, activeCalls: false, originate: false, configuration: true },
    implemented: false,
    health: { status: "UNKNOWN" },
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
  };
}

function status(): EngineStatus {
  return {
    engineId: "eng-1",
    provider: "KAMAILIO",
    implemented: false,
    capabilities: { health: true, routing: true, registration: false, activeCalls: false, originate: false, configuration: true },
    health: { status: "UNKNOWN", detail: "no live probe" },
    correlationId: "cid-1",
    checkedAt: "2026-11-18T00:00:00.000Z",
    connection: { state: "UNCONFIGURED", endpointConfigured: false },
    version: { desiredVersion: null, appliedVersion: null, syncState: null, versions: 0 },
    desired: { version: "abc1234", summary: { carriers: 0, trunks: 2, dids: 5, routes: 1 } },
  };
}

afterEach(() => vi.clearAllMocks());

describe("EngineDetailView", () => {
  it("renders identity, health, connection, version and desired summary", async () => {
    vi.mocked(getEngine).mockResolvedValue(engine());
    vi.mocked(getEngineStatus).mockResolvedValue(status());
    renderDetail();

    expect(await screen.findByRole("heading", { name: "kamailio-vps" })).toBeInTheDocument();
    // health + connection states render
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    expect(screen.getByText("UNCONFIGURED")).toBeInTheDocument();
    // desired summary counts (trunks=2, dids=5)
    expect(screen.getByText("Trunks")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("surfaces an error from either request", async () => {
    vi.mocked(getEngine).mockResolvedValue(engine());
    vi.mocked(getEngineStatus).mockRejectedValue(new ApiError({ title: "Engine not found", status: 404 }));
    renderDetail();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Engine not found"));
  });
});
