import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { SipTrunk } from "@/lib/contracts";

vi.mock("@/lib/telecom/sip-trunks-actions", () => ({
  listSipTrunks: vi.fn(),
  getSipTrunk: vi.fn(),
  createSipTrunk: vi.fn(),
  updateSipTrunk: vi.fn(),
  deleteSipTrunk: vi.fn(),
}));
// The create/edit form loads carriers for its (required) carrier picker.
vi.mock("@/lib/telecom/carriers-actions", () => ({ listCarriers: vi.fn() }));

import { createSipTrunk, deleteSipTrunk, getSipTrunk, listSipTrunks } from "@/lib/telecom/sip-trunks-actions";
import { listCarriers } from "@/lib/telecom/carriers-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { SipTrunksView } from "./sip-trunks-view";

// Full trunk permissions so the create/edit/delete affordances render.
const allPermsLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "RESELLER",
  roles: [],
  permissions: ["sip_trunk.read", "sip_trunk.create", "sip_trunk.update", "sip_trunk.delete", "carrier.read"],
});

function renderView(loader: SessionLoader = allPermsLoader) {
  return render(
    <SessionProvider loader={loader}>
      <SipTrunksView />
    </SessionProvider>,
  );
}

function trunk(overrides: Partial<SipTrunk> = {}): SipTrunk {
  return {
    id: crypto.randomUUID(),
    name: "Primary trunk",
    carrierId: crypto.randomUUID(),
    carrier: { id: crypto.randomUUID(), name: "Acme SIP", scope: "TENANT" },
    direction: "BIDIRECTIONAL",
    sipUri: null,
    host: "sip.acme.example",
    port: 5060,
    transport: "UDP",
    tls: false,
    authMode: "CREDENTIALS",
    allowedIps: [],
    codecs: ["OPUS"],
    srtp: false,
    dtmfMode: null,
    maxCps: null,
    maxConcurrentCalls: null,
    status: "ACTIVE",
    credential: null,
    health: { status: "UNKNOWN", detail: "no health check configured" },
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("SipTrunksView", () => {
  it("renders the first page with carrier, transport and honest UNKNOWN health", async () => {
    vi.mocked(listSipTrunks).mockResolvedValue({
      items: [trunk({ name: "Primary trunk", transport: "TLS", tls: true })],
      nextCursor: null,
    });
    renderView();

    expect(await screen.findByText("Primary trunk")).toBeInTheDocument();
    expect(screen.getByText("Acme SIP")).toBeInTheDocument();
    expect(screen.getByText("TLS · TLS")).toBeInTheDocument(); // transport TLS + tls flag
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the trunk fetched by id", async () => {
    const row = trunk({ name: "Primary trunk", authMode: "IP", allowedIps: ["203.0.113.10"] });
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getSipTrunk).mockResolvedValue(trunk({ id: row.id, name: "Primary trunk", authMode: "IP", allowedIps: ["203.0.113.10"] }));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Primary trunk" }));

    await waitFor(() => expect(getSipTrunk).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only fields appear in the drawer.
    expect(await screen.findByText("Auth mode")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
  });

  it("shows the empty state when there are no trunks", async () => {
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText(/No SIP trunks are configured yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [trunk({ name: "Primary trunk" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("Primary trunk")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(listSipTrunks).toHaveBeenLastCalledWith({ status: "ACTIVE" }, expect.anything()));
  });

  it("filters by direction, refetching with the direction query param", async () => {
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [trunk({ name: "Primary trunk" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("Primary trunk")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by direction" }), { target: { value: "OUTBOUND" } });
    await waitFor(() => expect(listSipTrunks).toHaveBeenLastCalledWith({ direction: "OUTBOUND" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [trunk({ name: "Primary trunk" })], nextCursor: null });
    renderView();
    const box = await screen.findByRole("searchbox", { name: "Search SIP trunks" });

    fireEvent.change(box, { target: { value: "primary" } });
    await waitFor(() => expect(listSipTrunks).toHaveBeenLastCalledWith({ q: "primary" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listSipTrunks)
      .mockResolvedValueOnce({ items: [trunk({ name: "Primary trunk" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText("Primary trunk")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by transport" }), { target: { value: "TLS" } });
    expect(await screen.findByText(/No SIP trunks match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listSipTrunks).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listSipTrunks)
      .mockResolvedValueOnce({ items: [trunk({ name: "Trunk One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [trunk({ name: "Trunk Two" })], nextCursor: null });
    renderView();

    expect(await screen.findByText("Trunk One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listSipTrunks).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Trunk Two")).toBeInTheDocument();
    expect(screen.getByText("Trunk One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("creates a trunk from the New-trunk form (carrier picked) and reloads the list", async () => {
    const carrierId = crypto.randomUUID();
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(listCarriers).mockResolvedValue({ items: [{ id: carrierId, name: "Acme SIP" }], nextCursor: null } as never);
    vi.mocked(createSipTrunk).mockResolvedValue(trunk({ name: "New Trunk", carrierId }));
    renderView();
    await screen.findByText(/No SIP trunks are configured yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New trunk" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New Trunk" } });
    // Carrier picker is required — wait for the loaded option, then select it.
    await screen.findByRole("option", { name: "Acme SIP" });
    fireEvent.change(screen.getByRole("combobox", { name: "Carrier" }), { target: { value: carrierId } });
    fireEvent.click(screen.getByRole("button", { name: "Create trunk" }));

    await waitFor(() => expect(createSipTrunk).toHaveBeenCalledWith(expect.objectContaining({ name: "New Trunk", carrierId })));
    // list refetched (first-page call on mount + after the save)
    await waitFor(() => expect(vi.mocked(listSipTrunks).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hides New trunk without sip_trunk.create permission", async () => {
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [], nextCursor: null });
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["sip_trunk.read"] }));
    await screen.findByText(/No SIP trunks are configured yet/i);
    expect(screen.queryByRole("button", { name: "New trunk" })).toBeNull();
  });

  it("deletes a trunk via the detail drawer after confirmation", async () => {
    const row = trunk({ name: "Primary trunk" });
    vi.mocked(listSipTrunks).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getSipTrunk).mockResolvedValue(row);
    vi.mocked(deleteSipTrunk).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Primary trunk" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" })); // drawer footer → opens confirm
    const confirm = await screen.findByRole("button", { name: "Delete" }); // confirm dialog's Delete
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteSipTrunk).toHaveBeenCalledWith(row.id));
  });
});
