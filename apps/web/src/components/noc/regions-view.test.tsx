import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Region } from "@/lib/contracts";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/telecom/telecom-actions", () => ({ listRegions: vi.fn() }));

import { listRegions } from "@/lib/telecom/telecom-actions";
import { RegionsView } from "./regions-view";

function region(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    code: "us-east",
    name: "US East",
    country: "US",
    timezone: "America/New_York",
    providerRegion: null,
    failoverRegionId: null,
    status: "ACTIVE",
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("RegionsView", () => {
  it("renders a row per region", async () => {
    vi.mocked(listRegions).mockResolvedValue([region()]);
    render(<RegionsView />);
    expect(await screen.findByText("us-east")).toBeInTheDocument();
    expect(screen.getByText("US East")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    vi.mocked(listRegions).mockResolvedValue([]);
    render(<RegionsView />);
    expect(await screen.findByText("No regions are configured yet.")).toBeInTheDocument();
  });

  it("surfaces an API error", async () => {
    vi.mocked(listRegions).mockRejectedValue(new ApiError({ title: "Insufficient permissions", status: 403 }));
    render(<RegionsView />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Insufficient permissions"));
  });
});
