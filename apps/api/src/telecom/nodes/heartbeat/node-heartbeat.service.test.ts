import { describe, expect, it, vi } from "vitest";
import { TelecomCredentialType } from "@prisma/client";
import { NodeHeartbeatService } from "./node-heartbeat.service";
import { NullHeartbeatAuthenticator } from "./heartbeat-authenticator";

const FP = "a".repeat(64); // a stand-in SHA-256 fingerprint

function makeService(node: { credentialId: string | null; credType?: TelecomCredentialType; hint?: string | null } | null) {
  const nodeHealthUpdate = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(
    node === null
      ? null
      : { id: "n1", credentialId: node.credentialId, credential: node.credentialId ? { type: node.credType, hint: node.hint ?? null } : null },
  );
  const prisma = {
    telecomNode: { findFirst },
    nodeHealth: { update: nodeHealthUpdate },
  } as unknown as ConstructorParameters<typeof NodeHeartbeatService>[0];
  return { service: new NodeHeartbeatService(prisma), findFirst, nodeHealthUpdate };
}

describe("NodeHeartbeatService.ingest", () => {
  it("fails closed with no verified identity — and does NOT look the node up (no existence oracle)", async () => {
    const { service, findFirst } = makeService({ credentialId: null });
    await expect(service.ingest("n1", null, "c1")).rejects.toThrow(/not authenticated/i);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("404s an unknown node (only after authentication)", async () => {
    const { service } = makeService(null);
    await expect(service.ingest("missing", { fingerprint: FP }, "c1")).rejects.toThrow(/not found/i);
  });

  it("403s a node with no NODE_AGENT credential", async () => {
    const { service, nodeHealthUpdate } = makeService({ credentialId: null });
    await expect(service.ingest("n1", { fingerprint: FP }, "c1")).rejects.toThrow(/no node-agent credential/i);
    expect(nodeHealthUpdate).not.toHaveBeenCalled();
  });

  it("403s when the credential is the wrong type (not NODE_AGENT)", async () => {
    const { service } = makeService({ credentialId: "cred1", credType: TelecomCredentialType.SIP_PASSWORD, hint: FP });
    await expect(service.ingest("n1", { fingerprint: FP }, "c1")).rejects.toThrow(/no node-agent credential/i);
  });

  it("403s when the presented fingerprint does not match the credential hint (identity binding)", async () => {
    const { service, nodeHealthUpdate } = makeService({ credentialId: "cred1", credType: TelecomCredentialType.NODE_AGENT, hint: "b".repeat(64) });
    await expect(service.ingest("n1", { fingerprint: FP }, "c1")).rejects.toThrow(/does not match/i);
    expect(nodeHealthUpdate).not.toHaveBeenCalled();
  });

  it("accepts a matching heartbeat: stamps lastHeartbeatAt only (no status change)", async () => {
    const { service, nodeHealthUpdate } = makeService({ credentialId: "cred1", credType: TelecomCredentialType.NODE_AGENT, hint: FP });
    const ack = await service.ingest("n1", { fingerprint: FP }, "c1");
    expect(ack).toEqual({ nodeId: "n1", acceptedAt: expect.any(Date) });
    expect(nodeHealthUpdate).toHaveBeenCalledWith({ where: { nodeId: "n1" }, data: { lastHeartbeatAt: expect.any(Date) } });
    // liveness only — the call sets no `status` field
    const data = nodeHealthUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
  });
});

describe("NullHeartbeatAuthenticator", () => {
  it("never produces an identity (fail closed — no mTLS terminator wired)", async () => {
    const auth = new NullHeartbeatAuthenticator();
    expect(await auth.verify({} as never)).toBeNull();
  });
});
