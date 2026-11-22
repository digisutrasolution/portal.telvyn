import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Did } from "@/lib/contracts";

vi.mock("@/lib/telecom/dids-actions", () => ({
  listDids: vi.fn(),
  getDid: vi.fn(),
  createDid: vi.fn(),
  updateDid: vi.fn(),
  deleteDid: vi.fn(),
}));
// The create/edit form loads these for its (optional) relationship pickers.
vi.mock("@/lib/telecom/carriers-actions", () => ({ listCarriers: vi.fn() }));
vi.mock("@/lib/telecom/sip-trunks-actions", () => ({ listSipTrunks: vi.fn() }));
vi.mock("@/lib/telecom/routing-actions", () => ({ listRoutingProfiles: vi.fn() }));
vi.mock("@/lib/telecom/telecom-actions", () => ({ listRegions: vi.fn() }));

import { createDid, deleteDid, getDid, listDids, updateDid } from "@/lib/telecom/dids-actions";
import { listCarriers } from "@/lib/telecom/carriers-actions";
import { listSipTrunks } from "@/lib/telecom/sip-trunks-actions";
import { listRoutingProfiles } from "@/lib/telecom/routing-actions";
import { listRegions } from "@/lib/telecom/telecom-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { NumbersView } from "./numbers-view";

// `did.manage` present so the create/edit/delete affordances render.
const allPermsLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "RESELLER",
  roles: [],
  permissions: ["did.read", "did.manage", "carrier.read", "sip_trunk.read", "routing.read"],
});

function renderView(loader: SessionLoader = allPermsLoader) {
  return render(
    <SessionProvider loader={loader}>
      <NumbersView />
    </SessionProvider>,
  );
}

const emptyPage = { items: [], nextCursor: null } as never;

function did(overrides: Partial<Did> = {}): Did {
  return {
    id: crypto.randomUUID(),
    e164: "+14155550100",
    country: "US",
    status: "ACTIVE",
    carrierId: null,
    sipTrunkId: null,
    routingProfileId: null,
    regionId: null,
    assignedAt: null,
    health: { status: "UNKNOWN", detail: "no health check configured" },
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("NumbersView", () => {
  it("renders the first page with number, status and honest UNKNOWN health", async () => {
    vi.mocked(listDids).mockResolvedValue({
      items: [
        did({ e164: "+14155550100", status: "ACTIVE", assignedAt: "2026-10-01T12:00:00.000Z", carrierId: "c0ffee00-0000-0000-0000-000000000000" }),
        did({ e164: "+442071234567", status: "AVAILABLE", country: "GB" }),
      ],
      nextCursor: null,
    });
    renderView();

    expect(await screen.findByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("+442071234567")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("AVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument(); // assignedAt date-only
    expect(screen.getByText("c0ffee00")).toBeInTheDocument(); // carrier short ref
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the number fetched by id", async () => {
    const routingProfileId = "11111111-2222-3333-4444-555555555555";
    const row = did({ e164: "+14155550100" });
    vi.mocked(listDids).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getDid).mockResolvedValue(did({ id: row.id, e164: "+14155550100", routingProfileId }));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View +14155550100" }));

    await waitFor(() => expect(getDid).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only fields appear in the drawer (full related-resource id, not the list's short ref).
    expect(await screen.findByText("Routing profile")).toBeInTheDocument();
    expect(screen.getByText(routingProfileId)).toBeInTheDocument();
  });

  it("shows the empty state when there are no numbers", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText(/No numbers in your inventory yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [did({ e164: "+14155550100" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("+14155550100")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "AVAILABLE" } });
    await waitFor(() => expect(listDids).toHaveBeenLastCalledWith({ status: "AVAILABLE" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [did({ e164: "+14155550100" })], nextCursor: null });
    renderView();
    const box = await screen.findByRole("searchbox", { name: "Search numbers" });

    fireEvent.change(box, { target: { value: "+1415" } });
    await waitFor(() => expect(listDids).toHaveBeenLastCalledWith({ q: "+1415" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listDids)
      .mockResolvedValueOnce({ items: [did({ e164: "+14155550100" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText("+14155550100")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "RELEASED" } });
    expect(await screen.findByText(/No numbers match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listDids).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listDids)
      .mockResolvedValueOnce({ items: [did({ e164: "+1111111111" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [did({ e164: "+2222222222" })], nextCursor: null });
    renderView();

    expect(await screen.findByText("+1111111111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listDids).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("+2222222222")).toBeInTheDocument();
    expect(screen.getByText("+1111111111")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("creates a number from the New-number form and reloads the list", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(listCarriers).mockResolvedValue(emptyPage);
    vi.mocked(listSipTrunks).mockResolvedValue(emptyPage);
    vi.mocked(listRoutingProfiles).mockResolvedValue(emptyPage);
    vi.mocked(listRegions).mockResolvedValue([]);
    vi.mocked(createDid).mockResolvedValue(did({ e164: "+14155559999" }));
    renderView();
    await screen.findByText(/No numbers in your inventory yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New number" }));
    fireEvent.change(await screen.findByLabelText("Number"), { target: { value: "+14155559999" } });
    fireEvent.click(screen.getByRole("button", { name: "Create number" }));

    await waitFor(() => expect(createDid).toHaveBeenCalledWith(expect.objectContaining({ number: "+14155559999" })));
    await waitFor(() => expect(vi.mocked(listDids).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("creates a number with a selected region", async () => {
    const regionId = crypto.randomUUID();
    vi.mocked(listDids).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(listCarriers).mockResolvedValue(emptyPage);
    vi.mocked(listSipTrunks).mockResolvedValue(emptyPage);
    vi.mocked(listRoutingProfiles).mockResolvedValue(emptyPage);
    vi.mocked(listRegions).mockResolvedValue([
      { id: regionId, code: "us-east", name: "US East", country: "US", timezone: "America/New_York" } as never,
    ]);
    vi.mocked(createDid).mockResolvedValue(did({ e164: "+14155550100", regionId }));
    renderView();
    await screen.findByText(/No numbers in your inventory yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New number" }));
    fireEvent.change(await screen.findByLabelText("Number"), { target: { value: "+14155550100" } });
    await screen.findByRole("option", { name: "US East (us-east)" });
    fireEvent.change(screen.getByRole("combobox", { name: "Region" }), { target: { value: regionId } });
    fireEvent.click(screen.getByRole("button", { name: "Create number" }));

    await waitFor(() => expect(createDid).toHaveBeenCalledWith(expect.objectContaining({ number: "+14155550100", regionId })));
  });

  it("edit sends regionId as null when the region is cleared (detach)", async () => {
    const regionId = crypto.randomUUID();
    const row = did({ e164: "+14155550100", regionId });
    vi.mocked(listDids).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getDid).mockResolvedValue(row);
    vi.mocked(listCarriers).mockResolvedValue(emptyPage);
    vi.mocked(listSipTrunks).mockResolvedValue(emptyPage);
    vi.mocked(listRoutingProfiles).mockResolvedValue(emptyPage);
    // Region list doesn't include the current id; it's seeded by id so the picker still shows + can be cleared.
    vi.mocked(listRegions).mockResolvedValue([]);
    vi.mocked(updateDid).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View +14155550100" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const region = await screen.findByRole("combobox", { name: "Region" });
    expect((region as HTMLSelectElement).value).toBe(regionId); // seeded to the current region
    fireEvent.change(region, { target: { value: "" } }); // clear → detach
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateDid).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateDid).mock.calls[0][1].regionId).toBeNull();
  });

  it("hides New number without did.manage permission", async () => {
    vi.mocked(listDids).mockResolvedValue({ items: [], nextCursor: null });
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["did.read"] }));
    await screen.findByText(/No numbers in your inventory yet/i);
    expect(screen.queryByRole("button", { name: "New number" })).toBeNull();
  });

  it("deletes a number via the detail drawer after confirmation", async () => {
    const row = did({ e164: "+14155550100" });
    vi.mocked(listDids).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getDid).mockResolvedValue(row);
    vi.mocked(deleteDid).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View +14155550100" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" })); // drawer footer → opens confirm
    const confirm = await screen.findByRole("button", { name: "Delete" }); // confirm dialog's Delete
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteDid).toHaveBeenCalledWith(row.id));
  });
});
