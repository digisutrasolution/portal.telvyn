import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { LcrPolicy } from "@/lib/contracts";

vi.mock("@/lib/telecom/lcr-actions", () => ({
  listLcrPolicies: vi.fn(),
  getLcrPolicy: vi.fn(),
  createLcrPolicy: vi.fn(),
  updateLcrPolicy: vi.fn(),
  deleteLcrPolicy: vi.fn(),
}));

// The routes editor loads carriers for its (required) carrier picker.
vi.mock("@/lib/telecom/carriers-actions", () => ({ listCarriers: vi.fn() }));

import { createLcrPolicy, deleteLcrPolicy, getLcrPolicy, listLcrPolicies, updateLcrPolicy } from "@/lib/telecom/lcr-actions";
import { listCarriers } from "@/lib/telecom/carriers-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { LcrView } from "./lcr-view";

// `routing.manage` present (LCR reuses the routing perm) so create/edit/delete render.
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
      <LcrView />
    </SessionProvider>,
  );
}

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
    renderView();

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
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));

    await waitFor(() => expect(getLcrPolicy).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only content: the candidate prefix + cost formatted from integer micros (list shows only a count).
    expect(await screen.findByText("Candidates (1)")).toBeInTheDocument();
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.getByText("0.0012 GBP")).toBeInTheDocument(); // 1200 micros → 0.0012
  });

  it("shows the empty state when there are no policies", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText(/No LCR policies are configured yet/i)).toBeInTheDocument();
  });

  it("filters by strategy, refetching with the strategy query param", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [policy({ name: "UK least cost" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("UK least cost")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by strategy" }), { target: { value: "WEIGHTED" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ strategy: "WEIGHTED" }, expect.anything()));
  });

  it("filters by state, sending enabled as a real boolean (false stays false)", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [policy({ name: "UK least cost" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("UK least cost")).toBeInTheDocument();

    const state = screen.getByRole("combobox", { name: "Filter by state" });
    fireEvent.change(state, { target: { value: "true" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ enabled: true }, expect.anything()));

    fireEvent.change(state, { target: { value: "false" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ enabled: false }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [policy({ name: "UK least cost" })], nextCursor: null });
    renderView();
    const box = await screen.findByRole("searchbox", { name: "Search LCR policies" });

    fireEvent.change(box, { target: { value: "uk" } });
    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ q: "uk" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listLcrPolicies)
      .mockResolvedValueOnce({ items: [policy({ name: "UK least cost" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText("UK least cost")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by state" }), { target: { value: "false" } });
    expect(await screen.findByText(/No LCR policies match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listLcrPolicies).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listLcrPolicies)
      .mockResolvedValueOnce({ items: [policy({ name: "Policy One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [policy({ name: "Policy Two" })], nextCursor: null });
    renderView();

    expect(await screen.findByText("Policy One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listLcrPolicies).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Policy Two")).toBeInTheDocument();
    expect(screen.getByText("Policy One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("creates a policy (no routes) from the New-policy form and reloads", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(createLcrPolicy).mockResolvedValue(policy({ name: "DE least cost" }));
    renderView();
    await screen.findByText(/No LCR policies are configured yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New policy" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "DE least cost" } });
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));

    // Body carries the name and does NOT send `routes` (routes editor is a later slice).
    await waitFor(() => expect(createLcrPolicy).toHaveBeenCalledWith(expect.objectContaining({ name: "DE least cost" })));
    expect(vi.mocked(createLcrPolicy).mock.calls[0][0]).not.toHaveProperty("routes");
    await waitFor(() => expect(vi.mocked(listLcrPolicies).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("edits a policy via the drawer, sending expectedVersion and NOT sending routes", async () => {
    const row = policy({ name: "UK least cost", version: 9 });
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getLcrPolicy).mockResolvedValue(row);
    vi.mocked(updateLcrPolicy).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "UK LCR" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateLcrPolicy).toHaveBeenCalledTimes(1));
    const [id, body] = vi.mocked(updateLcrPolicy).mock.calls[0];
    expect(id).toBe(row.id);
    expect(body).toEqual(expect.objectContaining({ name: "UK LCR", expectedVersion: 9 }));
    expect(body).not.toHaveProperty("routes"); // existing routes preserved
  });

  it("hides New policy without routing.manage permission", async () => {
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [], nextCursor: null });
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["routing.read"] }));
    await screen.findByText(/No LCR policies are configured yet/i);
    expect(screen.queryByRole("button", { name: "New policy" })).toBeNull();
  });

  it("deletes a policy via the detail drawer after confirmation", async () => {
    const row = policy({ name: "UK least cost" });
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getLcrPolicy).mockResolvedValue(row);
    vi.mocked(deleteLcrPolicy).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" })); // drawer footer → opens confirm
    const confirm = await screen.findByRole("button", { name: "Delete" }); // confirm dialog's Delete
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteLcrPolicy).toHaveBeenCalledWith(row.id));
  });

  it("edits routes via the drawer, saving the full set with expectedVersion, raw micros, and preserved fields", async () => {
    const carrierId = crypto.randomUUID();
    const row = policy({
      name: "UK least cost",
      version: 5,
      candidates: [
        // A route carrying a SIP trunk + effective date the editor does NOT expose — must round-trip.
        route({ carrierId, costMicros: 1200, prefix: "44", currency: "GBP", sipTrunkId: crypto.randomUUID(), effectiveFrom: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getLcrPolicy).mockResolvedValue(row);
    vi.mocked(listCarriers).mockResolvedValue({ items: [{ id: carrierId, name: "Acme" }], nextCursor: null } as never);
    vi.mocked(updateLcrPolicy).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit routes" }));
    const cost = await screen.findByLabelText("Cost (micros)");
    fireEvent.change(cost, { target: { value: "9999" } }); // raw integer micros
    fireEvent.click(screen.getByRole("button", { name: "Save routes" }));

    await waitFor(() => expect(updateLcrPolicy).toHaveBeenCalledTimes(1));
    const [id, body] = vi.mocked(updateLcrPolicy).mock.calls[0];
    expect(id).toBe(row.id);
    expect(body.expectedVersion).toBe(5);
    expect(body.routes).toHaveLength(1);
    expect(body.routes![0].costMicros).toBe(9999); // integer, no float
    expect(body.routes![0].carrierId).toBe(carrierId);
    expect(body.routes![0].sipTrunkId).toBe(row.candidates[0].sipTrunkId); // PRESERVED
    expect(body.routes![0].effectiveFrom).toBe("2026-01-01T00:00:00.000Z"); // PRESERVED
  });

  it("adds a route in the editor and saves the longer set", async () => {
    const carrierId = crypto.randomUUID();
    const row = policy({ name: "UK least cost", version: 1, candidates: [] });
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getLcrPolicy).mockResolvedValue(row);
    vi.mocked(listCarriers).mockResolvedValue({ items: [{ id: carrierId, name: "Acme" }], nextCursor: null } as never);
    vi.mocked(updateLcrPolicy).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit routes" }));
    await screen.findByRole("button", { name: "Add route" });
    fireEvent.click(screen.getByRole("button", { name: "Add route" }));

    await screen.findByRole("option", { name: "Acme" });
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: carrierId } });
    fireEvent.change(screen.getByLabelText("Prefix"), { target: { value: "44" } });
    fireEvent.change(screen.getByLabelText("Cost (micros)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save routes" }));

    await waitFor(() => expect(updateLcrPolicy).toHaveBeenCalledTimes(1));
    const body = vi.mocked(updateLcrPolicy).mock.calls[0][1];
    expect(body.routes).toHaveLength(1);
    expect(body.routes![0]).toEqual(expect.objectContaining({ carrierId, prefix: "44", costMicros: 5000 }));
  });

  it("hides Edit routes without routing.manage permission", async () => {
    const row = policy({ name: "UK least cost" });
    vi.mocked(listLcrPolicies).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getLcrPolicy).mockResolvedValue(row);
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["routing.read"] }));

    fireEvent.click(await screen.findByRole("button", { name: "View UK least cost" }));
    await screen.findByText("Candidates (2)"); // drawer loaded
    expect(screen.queryByRole("button", { name: "Edit routes" })).toBeNull();
  });
});
