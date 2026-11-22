import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { RoutingProfile } from "@/lib/contracts";

vi.mock("@/lib/telecom/routing-actions", () => ({
  listRoutingProfiles: vi.fn(),
  getRoutingProfile: vi.fn(),
  createRoutingProfile: vi.fn(),
  updateRoutingProfile: vi.fn(),
  deleteRoutingProfile: vi.fn(),
}));

import { createRoutingProfile, deleteRoutingProfile, getRoutingProfile, listRoutingProfiles, updateRoutingProfile } from "@/lib/telecom/routing-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { RoutingView } from "./routing-view";

// `routing.manage` present so the create/edit/delete affordances render.
const allPermsLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "RESELLER",
  roles: [],
  permissions: ["routing.read", "routing.manage"],
});

function renderView(loader: SessionLoader = allPermsLoader) {
  return render(
    <SessionProvider loader={loader}>
      <RoutingView />
    </SessionProvider>,
  );
}

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
    renderView();

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
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));

    await waitFor(() => expect(getRoutingProfile).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only content: failover conditions + a rule destination (the list shows only a count).
    expect(await screen.findByText("NO_ANSWER")).toBeInTheDocument();
    expect(screen.getByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("Rules (2)")).toBeInTheDocument();
  });

  it("shows the empty state when there are no profiles", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText(/No routing profiles are configured yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [profile({ name: "Inbound default" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("Inbound default")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ status: "ACTIVE" }, expect.anything()));
  });

  it("filters by strategy, refetching with the strategy query param", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [profile({ name: "Inbound default" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("Inbound default")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by strategy" }), { target: { value: "WEIGHTED" } });
    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ strategy: "WEIGHTED" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [profile({ name: "Inbound default" })], nextCursor: null });
    renderView();
    const box = await screen.findByRole("searchbox", { name: "Search routing profiles" });

    fireEvent.change(box, { target: { value: "inbound" } });
    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ q: "inbound" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listRoutingProfiles)
      .mockResolvedValueOnce({ items: [profile({ name: "Inbound default" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText("Inbound default")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by direction" }), { target: { value: "OUTBOUND" } });
    expect(await screen.findByText(/No routing profiles match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listRoutingProfiles).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listRoutingProfiles)
      .mockResolvedValueOnce({ items: [profile({ name: "Profile One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [profile({ name: "Profile Two" })], nextCursor: null });
    renderView();

    expect(await screen.findByText("Profile One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listRoutingProfiles).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Profile Two")).toBeInTheDocument();
    expect(screen.getByText("Profile One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("creates a profile (policy only, no rules) from the New-profile form and reloads", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(createRoutingProfile).mockResolvedValue(profile({ name: "Outbound A" }));
    renderView();
    await screen.findByText(/No routing profiles are configured yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Outbound A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    // Body carries the name and does NOT send `rules` (rules editor is a later slice).
    await waitFor(() => expect(createRoutingProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Outbound A" })));
    expect(vi.mocked(createRoutingProfile).mock.calls[0][0]).not.toHaveProperty("rules");
    await waitFor(() => expect(vi.mocked(listRoutingProfiles).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hides New profile without routing.manage permission", async () => {
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [], nextCursor: null });
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["routing.read"] }));
    await screen.findByText(/No routing profiles are configured yet/i);
    expect(screen.queryByRole("button", { name: "New profile" })).toBeNull();
  });

  it("deletes a profile via the detail drawer after confirmation", async () => {
    const row = profile({ name: "Inbound default" });
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(row);
    vi.mocked(deleteRoutingProfile).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" })); // drawer footer → opens confirm
    const confirm = await screen.findByRole("button", { name: "Delete" }); // confirm dialog's Delete
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteRoutingProfile).toHaveBeenCalledWith(row.id));
  });

  it("edits rules via the drawer, saving the full replaced set with expectedVersion; failover round-trips", async () => {
    const row = profile({
      name: "Inbound default",
      version: 7,
      rules: [
        // A rule carrying a typed failover — loaded into the editable fields, it must round-trip on save.
        { id: "r1", destinationType: "PHONE_NUMBER", destination: "+14155550100", priority: 10, weight: null, enabled: true, timeoutSeconds: null, retryCount: null, carrierId: null, failoverDestination: "+14155559999", failoverDestinationType: "PHONE_NUMBER", failoverAfterSeconds: 20, schedule: null },
      ],
    });
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(row);
    vi.mocked(updateRoutingProfile).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
    // Editor loaded with the existing rule; change its (primary) destination.
    const dest = await screen.findByLabelText("Destination");
    fireEvent.change(dest, { target: { value: "+14155550111" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => expect(updateRoutingProfile).toHaveBeenCalledTimes(1));
    const [id, body] = vi.mocked(updateRoutingProfile).mock.calls[0];
    expect(id).toBe(row.id);
    expect(body.expectedVersion).toBe(7);
    expect(body.rules).toHaveLength(1);
    expect(body.rules![0].destination).toBe("+14155550111"); // edited
    expect(body.rules![0].failoverDestination).toBe("+14155559999"); // loaded + round-tripped
    expect(body.rules![0].failoverDestinationType).toBe("PHONE_NUMBER");
    expect(body.rules![0].failoverAfterSeconds).toBe(20);
  });

  it("edits a rule to add a typed failover and a time-of-day schedule", async () => {
    const row = profile({
      name: "Inbound default",
      version: 3,
      rules: [
        { id: "r1", destinationType: "PHONE_NUMBER", destination: "+14155550100", priority: 10, weight: null, enabled: true, timeoutSeconds: null, retryCount: null, carrierId: null, failoverDestination: null, failoverDestinationType: null, failoverAfterSeconds: null, schedule: null },
      ],
    });
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(row);
    vi.mocked(updateRoutingProfile).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));

    // Typed failover: pick a type, then its destination (disabled until a type is chosen).
    fireEvent.change(await screen.findByLabelText("Failover type"), { target: { value: "PHONE_NUMBER" } });
    fireEvent.change(screen.getByLabelText("Failover destination"), { target: { value: "+14155558888" } });
    fireEvent.change(screen.getByLabelText("After (s)"), { target: { value: "15" } });

    // Schedule: enable, timezone, a day, and a time window.
    fireEvent.click(screen.getByLabelText("Restrict to a schedule"));
    fireEvent.change(await screen.findByLabelText("Timezone"), { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByLabelText("Mon"));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "17:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => expect(updateRoutingProfile).toHaveBeenCalledTimes(1));
    const rule = vi.mocked(updateRoutingProfile).mock.calls[0][1].rules![0];
    expect(rule.failoverDestinationType).toBe("PHONE_NUMBER");
    expect(rule.failoverDestination).toBe("+14155558888");
    expect(rule.failoverAfterSeconds).toBe(15);
    expect(rule.schedule).toEqual({ timezone: "America/New_York", daysOfWeek: [1], startMinute: 540, endMinute: 1020 });
  });

  it("blocks a failover destination type with no destination value", async () => {
    const row = profile({
      name: "Inbound default",
      version: 1,
      rules: [
        { id: "r1", destinationType: "PHONE_NUMBER", destination: "+14155550100", priority: 10, weight: null, enabled: true, timeoutSeconds: null, retryCount: null, carrierId: null, failoverDestination: null, failoverDestinationType: null, failoverAfterSeconds: null, schedule: null },
      ],
    });
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(row);
    vi.mocked(updateRoutingProfile).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
    fireEvent.change(await screen.findByLabelText("Failover type"), { target: { value: "PHONE_NUMBER" } });
    // Destination left blank → blocked.
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    expect(await screen.findByText("Failover needs a destination value.")).toBeInTheDocument();
    expect(updateRoutingProfile).not.toHaveBeenCalled();
  });

  it("adds a new rule in the editor and saves the longer set", async () => {
    const row = profile({ name: "Inbound default", version: 2 });
    const originalCount = row.rules.length;
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(row);
    vi.mocked(updateRoutingProfile).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
    await screen.findByRole("button", { name: "Save rules" });

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const dests = screen.getAllByLabelText("Destination");
    fireEvent.change(dests[dests.length - 1], { target: { value: "+14155550123" } }); // the new rule
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => expect(updateRoutingProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateRoutingProfile).mock.calls[0][1].rules).toHaveLength(originalCount + 1);
  });

  it("hides Edit rules without routing.manage permission", async () => {
    const row = profile({ name: "Inbound default" });
    vi.mocked(listRoutingProfiles).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getRoutingProfile).mockResolvedValue(row);
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["routing.read"] }));

    fireEvent.click(await screen.findByRole("button", { name: "View Inbound default" }));
    await screen.findByText("Rules (2)"); // drawer loaded
    expect(screen.queryByRole("button", { name: "Edit rules" })).toBeNull();
  });
});
