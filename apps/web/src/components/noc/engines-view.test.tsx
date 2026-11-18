import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Engine } from "@/lib/contracts";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/telecom/telecom-actions", () => ({ listEngines: vi.fn() }));

import { listEngines } from "@/lib/telecom/telecom-actions";
import { EnginesView } from "./engines-view";

function engine(overrides: Partial<Engine> = {}): Engine {
  return {
    id: "11111111-1111-1111-1111-111111111111",
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
    softwareCapabilities: {
      health: true,
      routing: true,
      registration: false,
      activeCalls: false,
      originate: false,
      configuration: true,
    },
    implemented: false,
    health: { status: "UNKNOWN" },
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("EnginesView", () => {
  it("renders a row per engine with its status and health", async () => {
    vi.mocked(listEngines).mockResolvedValue([engine(), engine({ id: "2", name: "freeswitch-a", type: "FREESWITCH", status: "DISABLED", version: null, health: { status: "DISABLED" } })]);
    render(<EnginesView />);

    expect(await screen.findByText("kamailio-vps")).toBeInTheDocument();
    expect(screen.getByText("freeswitch-a")).toBeInTheDocument();
    // engine name links to its detail page
    expect(screen.getByRole("link", { name: "kamailio-vps" })).toHaveAttribute(
      "href",
      "/infrastructure/11111111-1111-1111-1111-111111111111",
    );
    // status + health labels render (dot+label / badge text)
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("6.1.5")).toBeInTheDocument();
  });

  it("shows an honest empty state when there are no engines", async () => {
    vi.mocked(listEngines).mockResolvedValue([]);
    render(<EnginesView />);
    expect(await screen.findByText("No engines are configured yet.")).toBeInTheDocument();
  });

  it("surfaces an API error", async () => {
    vi.mocked(listEngines).mockRejectedValue(new ApiError({ title: "Insufficient permissions", status: 403 }));
    render(<EnginesView />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Insufficient permissions"));
  });
});
