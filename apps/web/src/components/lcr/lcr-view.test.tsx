import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { LcrPolicy } from "@/lib/contracts";

vi.mock("@/lib/telecom/lcr-actions", () => ({ listLcrPolicies: vi.fn(), getLcrPolicy: vi.fn() }));

import { getLcrPolicy, listLcrPolicies } from "@/lib/telecom/lcr-actions";
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
    expect(screen.getByText("Enabled", { selector: "span" })).toBeInTheDocument(); // the status badge (not the filter option)
    expect(screen.getByText("2")).toBeInTheDocument(); // candidate count
    expect(screen.getByText("7")).toBeInTheDocument(); // version
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the candidates (ordered, cost from micros) fetched by id", async () => {
    const row = policy({ name: "UK least cost" });
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getLcrPolicy).mockResolvedValue(
      policy({ id: row.id, name: "UK least cost", candidates: [route({ prefix: "44", costMicros: 1200, currency: "GBP" })] }),
    );
    render(<LcrView />);

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));

    await waitFor(() => expect(getLcrPolicy).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only content: the candidate prefix + cost formatted from integer micros (list shows only a count).
    expect(await screen.findByText("Candidates (1)")).toBeInTheDocument();
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.getByText("0.0012 GBP")).toBeInTheDocument(); // 1200 micros → 0.0012
  });

  it("shows the empty state when there are no policies", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [], nextCursor: null });
    render(<LcrView />);
    expect(await screen.findByText(/No LCR policies are configured yet/i)).toBeInTheDocument();
  });

  it("filters by strategy, refetching with the strategy query param", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [policy({ name: "UK least cost" })], nextCursor: null });
    render(<LcrView />);
    expect(await screen.findByText("UK least cost")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by strategy" }), { target: { value: "WEIGHTED" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ strategy: "WEIGHTED" }, expect.anything()));
  });

  it("filters by state, sending enabled as a real boolean (false stays false)", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [policy({ name: "UK least cost" })], nextCursor: null });
    render(<LcrView />);
    expect(await screen.findByText("UK least cost")).toBeInTheDocument();

    const state = screen.getByRole("combobox", { name: "Filter by state" });
    fireEvent.change(state, { target: { value: "true" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ enabled: true }, expect.anything()));

    fireEvent.change(state, { target: { value: "false" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ enabled: false }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [policy({ name: "UK least cost" })], nextCursor: null });
    render(<LcrView />);
    const box = await screen.findByRole("searchbox", { name: "Search LCR policies" });

    fireEvent.change(box, { target: { value: "uk" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ q: "uk" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listLcrPolicies)
      .mockResolvedValueOnce({ items: [policy({ name: "UK least cost" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<LcrView />);
    expect(await screen.findByText("UK least cost")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by state" }), { target: { value: "false" } });
    expect(await screen.findByText(/No LCR policies match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
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
