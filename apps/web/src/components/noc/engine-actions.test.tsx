import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import { SessionProvider, type SessionLoader, useSession } from "@/lib/session/session-context";

vi.mock("@/lib/telecom/telecom-actions", () => ({
  checkEngineHealth: vi.fn(),
  syncEngine: vi.fn(),
  rollbackEngine: vi.fn(),
}));

import { checkEngineHealth, rollbackEngine, syncEngine } from "@/lib/telecom/telecom-actions";
import { EngineActions } from "./engine-actions";

function ctx(permissions: string[]) {
  return { userId: "u", tenantId: "t", tenantType: "PLATFORM" as const, roles: [], permissions };
}

function Probe() {
  return <span data-testid="status">{useSession().status}</span>;
}

const ENGINE_NAME = "Edge SIP 1";

function renderActions(permissions: string[]) {
  const onChanged = vi.fn();
  const loader: SessionLoader = async () => ctx(permissions);
  render(
    <SessionProvider loader={loader}>
      <Probe />
      <EngineActions engineId="eng-1" engineName={ENGINE_NAME} onChanged={onChanged} />
    </SessionProvider>,
  );
  return { onChanged };
}

afterEach(() => vi.clearAllMocks());

describe("EngineActions", () => {
  it("renders nothing without telecom permissions", async () => {
    renderActions([]);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.queryByRole("button", { name: "Check health" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync configuration" })).toBeNull();
  });

  it("shows only Check health for telecom.health.read", async () => {
    renderActions(["telecom.health.read"]);
    expect(await screen.findByRole("button", { name: "Check health" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync configuration" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Roll back" })).toBeNull();
  });

  it("probes health directly and reports the result", async () => {
    vi.mocked(checkEngineHealth).mockResolvedValue({
      engineId: "eng-1",
      provider: "KAMAILIO",
      status: "UNKNOWN",
      reachability: "UNCONFIGURED",
      detail: "no probe",
      correlationId: "c1",
      checkedAt: "2026-11-18T00:00:00.000Z",
    });
    const { onChanged } = renderActions(["telecom.health.read"]);
    fireEvent.click(await screen.findByRole("button", { name: "Check health" }));
    await waitFor(() => expect(checkEngineHealth).toHaveBeenCalledWith("eng-1"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Health probe: UNKNOWN"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("type-to-confirm: the Sync CTA stays disabled until the engine name is typed exactly", async () => {
    renderActions(["telecom.manage"]);
    fireEvent.click(await screen.findByRole("button", { name: "Sync configuration" }));

    const cta = await screen.findByRole("button", { name: "Sync" });
    expect(cta).toBeDisabled();

    const input = screen.getByLabelText("Confirm engine name");
    fireEvent.change(input, { target: { value: "edge sip 1" } }); // wrong case → no match
    expect(cta).toBeDisabled();

    fireEvent.change(input, { target: { value: ENGINE_NAME } }); // exact match
    expect(cta).toBeEnabled();
  });

  it("syncs once the name matches and shows the honest 501 result", async () => {
    vi.mocked(syncEngine).mockRejectedValue(new ApiError({ title: "engine not_implemented", status: 501 }));
    renderActions(["telecom.manage"]);
    fireEvent.click(await screen.findByRole("button", { name: "Sync configuration" }));
    fireEvent.change(await screen.findByLabelText("Confirm engine name"), { target: { value: ENGINE_NAME } });
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(syncEngine).toHaveBeenCalledWith("eng-1"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("engine not_implemented"));
  });

  it("does not roll back when the confirm is cancelled", async () => {
    renderActions(["telecom.manage"]);
    fireEvent.click(await screen.findByRole("button", { name: "Roll back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(rollbackEngine).not.toHaveBeenCalled();
  });

  it("does not roll back while the typed name does not match", async () => {
    renderActions(["telecom.manage"]);
    fireEvent.click(await screen.findByRole("button", { name: "Roll back" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Confirm engine name"), { target: { value: "wrong" } });
    const cta = within(dialog).getByRole("button", { name: "Roll back" });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(rollbackEngine).not.toHaveBeenCalled();
  });
});
