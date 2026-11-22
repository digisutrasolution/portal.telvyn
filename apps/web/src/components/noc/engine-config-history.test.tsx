import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { ConfigVersion } from "@/lib/contracts";

vi.mock("@/lib/telecom/telecom-actions", () => ({ listEngineConfigVersions: vi.fn() }));

import { listEngineConfigVersions } from "@/lib/telecom/telecom-actions";
import { EngineConfigHistory } from "./engine-config-history";

function cv(overrides: Partial<ConfigVersion> = {}): ConfigVersion {
  return {
    id: crypto.randomUUID(),
    changeType: "UPDATE",
    kind: "desired",
    version: "abc123def456",
    previousVersion: "000111222333",
    summary: { carriers: 1, trunks: 2, dids: 5, routes: 1 },
    actorId: crypto.randomUUID(),
    correlationId: "corr-1",
    createdAt: "2026-11-20T09:30:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("EngineConfigHistory", () => {
  it("renders versions newest-first with change type, kind, prev → version and summary", async () => {
    vi.mocked(listEngineConfigVersions).mockResolvedValue({ items: [cv()], nextCursor: null });
    render(<EngineConfigHistory engineId="eng-1" />);

    expect(await screen.findByText("UPDATE")).toBeInTheDocument();
    expect(screen.getByText("desired")).toBeInTheDocument();
    expect(screen.getByText(/000111222333 →/)).toBeInTheDocument(); // previous → version
    expect(screen.getByText("abc123def456")).toBeInTheDocument();
    expect(screen.getByText(/carriers/)).toBeInTheDocument(); // summary counts
    expect(listEngineConfigVersions).toHaveBeenCalledWith("eng-1", {}, expect.anything());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the empty state when there are no versions", async () => {
    vi.mocked(listEngineConfigVersions).mockResolvedValue({ items: [], nextCursor: null });
    render(<EngineConfigHistory engineId="eng-1" />);
    expect(await screen.findByText(/No configuration versions recorded yet/i)).toBeInTheDocument();
  });

  it("loads more with the cursor and appends the older page", async () => {
    vi.mocked(listEngineConfigVersions)
      .mockResolvedValueOnce({ items: [cv({ version: "newnewnewnew" })], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [cv({ version: "oldoldoldold" })], nextCursor: null });
    render(<EngineConfigHistory engineId="eng-1" />);

    expect(await screen.findByText("newnewnewnew")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(listEngineConfigVersions).toHaveBeenLastCalledWith("eng-1", { cursor: "cur-2" }));
    expect(await screen.findByText("oldoldoldold")).toBeInTheDocument();
    expect(screen.getByText("newnewnewnew")).toBeInTheDocument(); // appended
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows an error state (RFC 7807 title) when the load fails", async () => {
    vi.mocked(listEngineConfigVersions).mockRejectedValue(new ApiError({ title: "Forbidden", status: 403 }));
    render(<EngineConfigHistory engineId="eng-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });
});
