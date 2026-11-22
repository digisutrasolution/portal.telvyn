import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Carrier } from "@/lib/contracts";

vi.mock("@/lib/telecom/carriers-actions", () => ({
  listCarriers: vi.fn(),
  getCarrier: vi.fn(),
  createCarrier: vi.fn(),
  updateCarrier: vi.fn(),
  deleteCarrier: vi.fn(),
  checkCarrierHealth: vi.fn(),
  listCarrierHealthEvents: vi.fn(),
}));

import { checkCarrierHealth, createCarrier, deleteCarrier, getCarrier, listCarrierHealthEvents, listCarriers, updateCarrier } from "@/lib/telecom/carriers-actions";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { CarriersView } from "./carriers-view";

// Full carrier permissions so the create/edit/delete affordances render.
const allPermsLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "RESELLER",
  roles: [],
  permissions: ["carrier.read", "carrier.create", "carrier.update", "carrier.delete"],
});

// Adds the health-read permission so the per-row Check (probe) button renders.
const healthLoader: SessionLoader = async () => ({
  userId: "u",
  tenantId: "t",
  tenantType: "RESELLER",
  roles: [],
  permissions: ["carrier.read", "telecom.health.read"],
});

function renderView(loader: SessionLoader = allPermsLoader) {
  return render(
    <SessionProvider loader={loader}>
      <CarriersView />
    </SessionProvider>,
  );
}

function carrier(overrides: Partial<Carrier> = {}): Carrier {
  return {
    id: crypto.randomUUID(),
    scope: "TENANT",
    name: "Acme SIP",
    type: "BIDIRECTIONAL",
    country: "US",
    regionId: null,
    status: "ACTIVE",
    priority: null,
    codecs: ["OPUS", "PCMU"],
    maxCps: null,
    maxConcurrentCalls: null,
    credential: null,
    health: { status: "UNKNOWN", detail: "no health check configured" },
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("CarriersView", () => {
  it("renders the first page with scope and honest UNKNOWN health", async () => {
    vi.mocked(listCarriers).mockResolvedValue({
      items: [carrier({ name: "Acme SIP", scope: "TENANT" }), carrier({ name: "Globe Telecom", scope: "SYSTEM" })],
      nextCursor: null,
    });
    renderView();

    expect(await screen.findByText("Acme SIP")).toBeInTheDocument();
    expect(screen.getByText("Globe Telecom")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM")).toBeInTheDocument();
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    // No next page → no Load more.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the detail drawer and shows the carrier fetched by id", async () => {
    const row = carrier({ name: "Acme SIP", maxConcurrentCalls: 500 });
    vi.mocked(listCarriers).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getCarrier).mockResolvedValue(carrier({ id: row.id, name: "Acme SIP", maxConcurrentCalls: 500, priority: 10 }));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Acme SIP" }));

    await waitFor(() => expect(getCarrier).toHaveBeenCalledWith(row.id, expect.anything()));
    // Detail-only fields appear in the drawer.
    expect(await screen.findByText("Max concurrent calls")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows the empty state when there are no carriers", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText(/No carriers are configured yet/i)).toBeInTheDocument();
  });

  it("filters by status, refetching with the status query param", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    renderView();
    expect(await screen.findByText("Acme SIP")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(listCarriers).toHaveBeenLastCalledWith({ status: "ACTIVE" }, expect.anything()));
  });

  it("debounces the search box, then refetches with the q param", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    renderView();
    const box = await screen.findByRole("searchbox", { name: "Search carriers" });

    fireEvent.change(box, { target: { value: "globe" } });
    await waitFor(() => expect(listCarriers).toHaveBeenLastCalledWith({ q: "globe" }, expect.anything()));
  });

  it("shows a no-matches state with a Clear action when a filter yields nothing", async () => {
    vi.mocked(listCarriers)
      .mockResolvedValueOnce({ items: [carrier({ name: "Acme SIP" })], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    expect(await screen.findByText("Acme SIP")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "DISABLED" } });
    expect(await screen.findByText(/No carriers match your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listCarriers).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("loads more with the cursor and appends the next page", async () => {
    vi.mocked(listCarriers)
      .mockResolvedValueOnce({ items: [carrier({ name: "Page One" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [carrier({ name: "Page Two" })], nextCursor: null });
    renderView();

    expect(await screen.findByText("Page One")).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(more);

    await waitFor(() => expect(listCarriers).toHaveBeenLastCalledWith({ cursor: "cur-2" }));
    expect(await screen.findByText("Page Two")).toBeInTheDocument();
    expect(screen.getByText("Page One")).toBeInTheDocument(); // still there (appended)
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull(); // exhausted
  });

  it("creates a carrier from the New-carrier form and reloads the list", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(createCarrier).mockResolvedValue(carrier({ name: "New Co" }));
    renderView();
    await screen.findByText(/No carriers are configured yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New carrier" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Create carrier" }));

    await waitFor(() => expect(createCarrier).toHaveBeenCalledWith(expect.objectContaining({ name: "New Co" })));
    // list refetched (first-page call on mount + after the save)
    await waitFor(() => expect(vi.mocked(listCarriers).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hides New carrier without carrier.create permission", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    renderView(async () => ({ userId: "u", tenantId: "t", tenantType: "RESELLER", roles: [], permissions: ["carrier.read"] }));
    await screen.findByText(/No carriers are configured yet/i);
    expect(screen.queryByRole("button", { name: "New carrier" })).toBeNull();
  });

  it("deletes a carrier via the detail drawer after confirmation", async () => {
    const row = carrier({ name: "Acme SIP" });
    vi.mocked(listCarriers).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getCarrier).mockResolvedValue(row);
    vi.mocked(deleteCarrier).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Acme SIP" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" })); // drawer footer → opens confirm
    // Confirm dialog's Delete button.
    const confirm = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteCarrier).toHaveBeenCalledWith(row.id));
  });

  it("creates a carrier with an inline credential (write-only secret)", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(createCarrier).mockResolvedValue(carrier({ name: "Vault Co" }));
    renderView();
    await screen.findByText(/No carriers are configured yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New carrier" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Vault Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach a credential" }));
    fireEvent.change(await screen.findByLabelText("Credential type"), { target: { value: "CARRIER_API" } });
    fireEvent.change(screen.getByLabelText("Credential label"), { target: { value: "Acme API key" } });
    const secret = screen.getByLabelText("Secret");
    expect(secret).toHaveAttribute("type", "password"); // write-only field
    fireEvent.change(secret, { target: { value: "s3cr3t-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Create carrier" }));

    await waitFor(() =>
      expect(createCarrier).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Vault Co",
          credential: { type: "CARRIER_API", label: "Acme API key", secret: "s3cr3t-value" },
        }),
      ),
    );
  });

  it("requires the secret once a credential is being attached", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [], nextCursor: null });
    renderView();
    await screen.findByText(/No carriers are configured yet/i);

    fireEvent.click(screen.getByRole("button", { name: "New carrier" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Vault Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach a credential" }));
    fireEvent.change(await screen.findByLabelText("Credential type"), { target: { value: "CARRIER_API" } });
    fireEvent.change(screen.getByLabelText("Credential label"), { target: { value: "Acme API key" } });
    // Secret left blank → submit must be blocked and createCarrier never called.
    fireEvent.click(screen.getByRole("button", { name: "Create carrier" }));

    expect(await screen.findByText("The secret is required.")).toBeInTheDocument();
    expect(createCarrier).not.toHaveBeenCalled();
  });

  it("probes a carrier's health from the Check button and reloads the list", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    vi.mocked(checkCarrierHealth).mockResolvedValue({ carrierId: "c1", status: "UNKNOWN", reachability: "UNCONFIGURED", detail: "no SIP endpoint configured", correlationId: "corr-1", checkedAt: "2026-11-23T00:00:00.000Z" });
    renderView(healthLoader);

    fireEvent.click(await screen.findByRole("button", { name: "Check health of Acme SIP" }));

    await waitFor(() => expect(checkCarrierHealth).toHaveBeenCalledTimes(1));
    // list re-fetched after the probe (mount call + reload) so the Health column reflects it
    await waitFor(() => expect(vi.mocked(listCarriers).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hides the Check and History buttons without telecom.health.read (carrier perms alone don't grant it)", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    renderView(); // allPermsLoader has carrier.* but NOT telecom.health.read
    await screen.findByText("Acme SIP");
    expect(screen.queryByRole("button", { name: /Check health of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Health history of/ })).toBeNull();
  });

  it("opens the health-history dialog from the History button", async () => {
    vi.mocked(listCarriers).mockResolvedValue({ items: [carrier({ name: "Acme SIP" })], nextCursor: null });
    vi.mocked(listCarrierHealthEvents).mockResolvedValue({
      items: [{ id: "h1", fromStatus: null, toStatus: "UNKNOWN", reason: "posture unverified", correlationId: "c1", createdAt: "2026-11-20T09:30:00.000Z" }],
      nextCursor: null,
    });
    renderView(healthLoader);

    fireEvent.click(await screen.findByRole("button", { name: "Health history of Acme SIP" }));

    expect(await screen.findByText(/Health history — Acme SIP/)).toBeInTheDocument();
    await waitFor(() => expect(listCarrierHealthEvents).toHaveBeenCalledWith(expect.any(String), {}, expect.anything()));
    expect(await screen.findByText("posture unverified")).toBeInTheDocument();
  });

  it("edits a carrier without touching its credential (credential omitted from the body)", async () => {
    const row = carrier({ name: "Acme SIP", credential: { id: crypto.randomUUID(), type: "CARRIER_API", label: "Live key", hint: null, scope: "TENANT" } });
    vi.mocked(listCarriers).mockResolvedValue({ items: [row], nextCursor: null });
    vi.mocked(getCarrier).mockResolvedValue(row);
    vi.mocked(updateCarrier).mockResolvedValue(row);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Acme SIP" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    // The current credential is shown as a reference; we don't touch it.
    expect(await screen.findByText(/Live key/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Telecom" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateCarrier).toHaveBeenCalledTimes(1));
    const body = vi.mocked(updateCarrier).mock.calls[0][1];
    expect(body).toEqual(expect.objectContaining({ name: "Acme Telecom" }));
    expect(body).not.toHaveProperty("credential"); // unchanged → not sent
    expect(body).not.toHaveProperty("credentialId");
  });
});
