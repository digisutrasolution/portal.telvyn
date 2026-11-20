import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { RoutingProfile } from "@/lib/contracts";

vi.mock("@/lib/telecom/routing-actions", () => ({ listRoutingProfiles: vi.fn(), getRoutingProfile: vi.fn() }));

import { getRoutingProfile, listRoutingProfiles } from "@/lib/telecom/routing-actions";
import { RoutingView } from "./routing-view";

function profile(overrides: Partial<RoutingProfile> = {}): RoutingProfile {
  return {
    id: crypto.randomUUID(),
    name: "Inbound default",
    direction: "INBOUND",
    description: null,
    status: "ACTIVE",
    version: 3,
    policy: {
      selectionStrategy: "PRIORITY",
      failoverEnabled: true,
      failoverConditions: ["NO_ANSWER"],
      maxAttempts: null,
      overallTimeoutSeconds: null,
    },
    rules: [
      { id: "r1", destinationType: "SIP_TRUNK", destination: "t1", priority: 10, weight: null, enabled: true, timeoutSeconds: null, retryCount: null, carrierId: null, failoverDestination: null, failoverDestinationType: null, failoverAfterSeconds: null, schedule: null },
      { id: "r2", destinationType: "PHONE_NUMBER", destination: "+14155550100", priority: 20, weight: null, enabled: true, timeoutSeconds: null, retryCount: null, carrierId: null, failoverDestination: null, failoverDestinationType: null, failoverAfterSeconds: null, schedule: null },
    ],
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("RoutingView", () => {
  it("renders a profile summary: strategy, failover and rule count", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({
      items: [profile({ name: "Inbound default", version: 3 })],
      nextCursor: null,
    });
    render(<RoutingView />);

    expect(await screen.findByText("Inbound default")).toBeInTheDocument();
    expect(screen.getByText("PRIORITY")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument(); // failoverEnabled
    expect(screen.getByText("2")).toBeInTheDocument(); // rule count
    expect(screen.getByText("3")).toBeInTheDocument(); // version
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the full policy + ordered rules fetched by id", async () => {
    const row = profile({ name: "Inbound default" });
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(profile({ id: row.id, name: "Inbound default" }));
    render(<RoutingView />);

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));

    await waitFor(() => expect(getRoutingProfile).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only content: failover conditions + a rule destination (the list shows only a count).
    expect(await screen.findByText("NO_ANSWER")).toBeInTheDocument();
    expect(screen.getByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("Rules (2)")).toBeInTheDocument();
  });

  it("shows the empty state when there are no profiles", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [], nextCursor: null });
    render(<RoutingView />);
    expect(await screen.findByText(/No routing profiles are configured yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [profile({ name: "Inbound default" })], nextCursor: null });
    render(<RoutingView />);
    expect(await screen.findByText("Inbound default")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ status: "ACTIVE" }, expect.anything()));
  });

  it("filters by strategy, refetching with the strategy query param", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [profile({ name: "Inbound default" })], nextCursor: null });
    render(<RoutingView />);
    expect(await screen.findByText("Inbound default")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by strategy" }), { target: { value: "WEIGHTED" } });
    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ strategy: "WEIGHTED" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [profile({ name: "Inbound default" })], nextCursor: null });
    render(<RoutingView />);
    const box = await screen.findByRole("searchbox", { name: "Search routing profiles" });

    fireEvent.change(box, { target: { value: "inbound" } });
    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ q: "inbound" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listRoutingProfiles)
      .mockResolvedValueOnce({ items: [profile({ name: "Inbound default" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<RoutingView />);
    expect(await screen.findByText("Inbound default")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by direction" }), { target: { value: "OUTBOUND" } });
    expect(await screen.findByText(/No routing profiles match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listRoutingProfiles).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<RoutingView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listRoutingProfiles)
      .mockResolvedValueOnce({ items: [profile({ name: "Profile One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [profile({ name: "Profile Two" })], nextCursor: null });
    render(<RoutingView />);

    expect(await screen.findByText("Profile One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Profile Two")).toBeInTheDocument();
    expect(screen.getByText("Profile One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
