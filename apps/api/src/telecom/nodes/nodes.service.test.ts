import { describe, expect, it, vi } from "vitest";
import { X509Certificate } from "node:crypto";
import { HealthStatus, TelecomCredentialType, TelecomEnvironment, TelecomStatus } from "@prisma/client";
import { NodesService } from "./nodes.service";
import type { CredentialScopeCtx } from "../secrets/telecom-credential.service";

// A throwaway self-signed client certificate (public — a test fixture, no private key).
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDIzCCAgugAwIBAgIUQ/yCuV4qD/fI3iu975qTSiWfofwwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWdGVsdnluLW5vZGUtYWdlbnQtdGVzdDAeFw0yNjExMjIy
MzE3NTlaFw0zNjExMTkyMzE3NTlaMCExHzAdBgNVBAMMFnRlbHZ5bi1ub2RlLWFn
ZW50LXRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCyMeg6ZPCy
8v/lQdFtZz7/BgEklMjV7uTkSz8u1nAbKFQjdOIBqiV4BlLlaZeFusy5cRuIXezH
bduoevpLuKOSkPVzJ1FxDti/ogqDXjhhvyGFICdYR4WxHAT0ZUoP11PiZ7BRq2CG
j7UEarhChnBa/sxHtSucXO44CAdmnRuuj2y5eKhLKoMFQOzK/50aDm8H445EPm1A
0hZMlVZzS+GBOBexfs75k90CCtMMf0+8kMrp/4TfUBxYrdAP5ppdKn5LWnTujv+j
HEWxk/QUwfnJyMefCtVxluln188sT3UOSnq+XqySLG500anhW83IKV07ZJ/usAA0
PncOCFEUIGPVAgMBAAGjUzBRMB0GA1UdDgQWBBRqlXaSo1yr8WJDm7rh2OCBlNJr
sTAfBgNVHSMEGDAWgBRqlXaSo1yr8WJDm7rh2OCBlNJrsTAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQARS37+s4XjXVpzrXpEBMjU+DBo7iqESx92
IiiuzkcmsWWe5NO8wOUyb+BZUa+MiqQRVMoWxmogJjXiLMu9H5WOtgUX6oiHBaPT
JiEc2h0mG4Ky20pT/Ci2R/Ma3FeWn6OhZWBUELYIaeMxzFciPYgWkE8BAIGSOIj/
Xd7cdvX3O0NmIrsJVICZCjwGOojOsY4pPWDXyjJGX/Abwc0rM6rEmfCegKoPfaAX
fvVkRwc4w/i6MTzz2gnwJOGgfFwZ73/Zgk79X4KEjTl93sVY4oOqoK3LcUUSEsMT
JylZ0shd2lodH+dX+TYu+aa6SXWWkxiy5N+eHwnmxEDZ8HreJjsZ
-----END CERTIFICATE-----`;

const EXPECTED_FP = new X509Certificate(TEST_CERT).fingerprint256.toLowerCase().replace(/:/g, "");
const scope: CredentialScopeCtx = { tenantId: "plat", isPlatform: true };

function nodeRow(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    name: "node-a",
    engineId: "e1",
    regionId: null,
    zone: null,
    environment: TelecomEnvironment.PRODUCTION,
    hostRef: null,
    status: TelecomStatus.DISABLED,
    version: null,
    maxCps: null,
    maxConcurrentCalls: null,
    health: { status: HealthStatus.UNKNOWN, latencyMs: null, lastHeartbeatAt: null },
    credential: { id: "cred-new", type: TelecomCredentialType.NODE_AGENT, label: "node-agent", hint: EXPECTED_FP, tenantId: null },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeService(opts: { existingCredentialId?: string | null; found?: boolean }) {
  const found = opts.found ?? true;
  const nodeUpdate = vi.fn().mockResolvedValue({});
  const credUpdate = vi.fn().mockResolvedValue({});
  // findFirst: first call selects {id, credentialId}; later get() returns the full row.
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(found ? { id: "n1", credentialId: opts.existingCredentialId ?? null } : null)
    .mockResolvedValue(nodeRow());
  const vaultCreate = vi.fn().mockResolvedValue({ id: "cred-new", type: TelecomCredentialType.NODE_AGENT, label: "node-agent", hint: EXPECTED_FP, scope: "SYSTEM" });
  const prisma = {
    telecomNode: { findFirst, update: nodeUpdate },
    telecomCredential: { update: credUpdate },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as ConstructorParameters<typeof NodesService>[0];
  const vault = { create: vaultCreate } as unknown as ConstructorParameters<typeof NodesService>[1];
  return { service: new NodesService(prisma, vault), nodeUpdate, credUpdate, vaultCreate, findFirst };
}

describe("NodesService.attachCredential", () => {
  it("derives the fingerprint, vaults the cert as NODE_AGENT, and links it to the node", async () => {
    const { service, vaultCreate, nodeUpdate, credUpdate } = makeService({ existingCredentialId: null });
    const view = await service.attachCredential(scope, "n1", { certificate: TEST_CERT });

    expect(vaultCreate).toHaveBeenCalledWith(scope, expect.objectContaining({ type: TelecomCredentialType.NODE_AGENT, hint: EXPECTED_FP, secret: TEST_CERT }));
    expect(nodeUpdate).toHaveBeenCalledWith({ where: { id: "n1" }, data: { credentialId: "cred-new" } });
    expect(credUpdate).not.toHaveBeenCalled(); // nothing to rotate
    expect(view.credential).toMatchObject({ type: TelecomCredentialType.NODE_AGENT, hint: EXPECTED_FP });
  });

  it("rejects an invalid certificate PEM (400) and vaults nothing", async () => {
    const { service, vaultCreate } = makeService({});
    await expect(service.attachCredential(scope, "n1", { certificate: "not a cert" })).rejects.toThrow(/invalid certificate/i);
    expect(vaultCreate).not.toHaveBeenCalled();
  });

  it("rotates: soft-deletes the prior credential when one is already attached", async () => {
    const { service, credUpdate } = makeService({ existingCredentialId: "cred-old" });
    await service.attachCredential(scope, "n1", { certificate: TEST_CERT });
    expect(credUpdate).toHaveBeenCalledWith({ where: { id: "cred-old" }, data: { deletedAt: expect.any(Date) } });
  });

  it("404s an unknown node", async () => {
    const { service } = makeService({ found: false });
    await expect(service.attachCredential(scope, "missing", { certificate: TEST_CERT })).rejects.toThrow(/not found/i);
  });
});

describe("NodesService.detachCredential", () => {
  it("clears the link and soft-deletes the credential when one is attached", async () => {
    const { service, nodeUpdate, credUpdate } = makeService({ existingCredentialId: "cred-old" });
    await service.detachCredential("n1");
    expect(nodeUpdate).toHaveBeenCalledWith({ where: { id: "n1" }, data: { credentialId: null } });
    expect(credUpdate).toHaveBeenCalledWith({ where: { id: "cred-old" }, data: { deletedAt: expect.any(Date) } });
  });

  it("is a no-op when the node has no credential", async () => {
    const { service, nodeUpdate, credUpdate } = makeService({ existingCredentialId: null });
    await service.detachCredential("n1");
    expect(nodeUpdate).not.toHaveBeenCalled();
    expect(credUpdate).not.toHaveBeenCalled();
  });
});
