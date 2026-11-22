import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import type { Node } from "@/lib/contracts";

vi.mock("@/lib/telecom/telecom-actions", () => ({ attachNodeCredential: vi.fn(), detachNodeCredential: vi.fn() }));

import { attachNodeCredential, detachNodeCredential } from "@/lib/telecom/telecom-actions";
import { NodeCredentialDialog } from "./node-credential-dialog";

function node(overrides: Partial<Node> = {}): Node {
  return {
    id: "n1",
    name: "node-a",
    engineId: "e1",
    regionId: null,
    zone: null,
    environment: "PRODUCTION",
    hostRef: null,
    status: "ACTIVE",
    version: null,
    maxCps: null,
    maxConcurrentCalls: null,
    health: { status: "UNKNOWN", latencyMs: null, lastHeartbeatAt: null },
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

const CERT = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";

afterEach(() => vi.clearAllMocks());

describe("NodeCredentialDialog", () => {
  it("shows the no-credential state and the Attach action when none is set", () => {
    render(<NodeCredentialDialog node={node()} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(/No credential attached/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
  });

  it("blocks attach with an empty certificate and never calls the API", () => {
    render(<NodeCredentialDialog node={node()} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Paste the node's client certificate/i);
    expect(attachNodeCredential).not.toHaveBeenCalled();
  });

  it("attaches a pasted certificate, then reloads and closes", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    vi.mocked(attachNodeCredential).mockResolvedValue(node());
    render(<NodeCredentialDialog node={node()} onClose={onClose} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Certificate (PEM)"), { target: { value: CERT } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "edge-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    await waitFor(() => expect(attachNodeCredential).toHaveBeenCalledWith("n1", { certificate: CERT, label: "edge-01" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the current fingerprint + Rotate/Detach when a credential exists", () => {
    const withCred = node({ credential: { id: "c1", type: "NODE_AGENT", label: "edge-01 agent", hint: "abc123fingerprint", scope: "SYSTEM" } });
    render(<NodeCredentialDialog node={withCred} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText("edge-01 agent")).toBeInTheDocument();
    expect(screen.getByText("abc123fingerprint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detach" })).toBeInTheDocument();
  });

  it("detaches an existing credential, then reloads and closes", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    vi.mocked(detachNodeCredential).mockResolvedValue(undefined);
    const withCred = node({ credential: { id: "c1", type: "NODE_AGENT", label: "edge-01", hint: "fp", scope: "SYSTEM" } });
    render(<NodeCredentialDialog node={withCred} onClose={onClose} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    await waitFor(() => expect(detachNodeCredential).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces an API error (e.g. invalid PEM → 400) and stays open", async () => {
    vi.mocked(attachNodeCredential).mockRejectedValue(new ApiError({ title: "Invalid certificate PEM", status: 400 }));
    const onClose = vi.fn();
    render(<NodeCredentialDialog node={node()} onClose={onClose} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText("Certificate (PEM)"), { target: { value: "not a cert" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid certificate PEM"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
