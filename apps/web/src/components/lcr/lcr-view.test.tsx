import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { LcrPolicy } from "@/lib/contracts";

vi.mock("@/lib/telecom/lcr-actions", () => ({ listLcrPolicies: vi.fn() }));

import { listLcrPolicies } from "@/lib/telecom/lcr-actions";
import { LcrView } from "./lcr-view";

function route(overrides: Partial<LcrPolicy["candidates"][number]> = {}): LcrPolicy["candidates"][number] {
  return {
    id: crypto.randomUUID(),
    carrierId: crypto.randomUUID(),
    sipTrunkId: null,
    prefix: "44",
    country: "GB",
    costMicros: 1200,
    currency: "GBP",
    priority: 10,
    weight: null,
    enabled: true,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  };
}

function policy(overrides: Partial<LcrPolicy> = {}): LcrPolicy {
  return {
    id: crypto.randomUUID(),
    name: "UK least cost",
    description: null,
    selectionStrategy: "LOWEST_COST",
    enabled: true,
    version: 2,
    candidates: [route(), route({ prefix: "1" })],
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("LcrView", () => {
  it("renders a policy summary: strategy, enabled and candidate count", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({
      items: [policy({ name: "UK least cost", version: 7 })],
      nextCursor: null,
    });
    render(<LcrView />);

    expect(await screen.findByText("UK least cost")).toBeInTheDocument();
    expect(screen.getByText("LOWEST_COST")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // candidate count
    expect(screen.getByText("7")).toBeInTheDocument(); // version
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the empty state when there are no policies", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [], nextCursor: null });
    render(<LcrView />);
    expect(await screen.findByText(/No LCR policies are configured yet/i)).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listLcrPolicies).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<LcrView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listLcrPolicies)
      .mockResolvedValueOnce({ items: [policy({ name: "Policy One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [policy({ name: "Policy Two" })], nextCursor: null });
    render(<LcrView />);

    expect(await screen.findByText("Policy One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Policy Two")).toBeInTheDocument();
    expect(screen.getByText("Policy One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
