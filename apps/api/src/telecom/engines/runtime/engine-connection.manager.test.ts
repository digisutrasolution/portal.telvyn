import { describe, expect, it } from "vitest";
import { TelecomEngineType, TelecomStatus } from "@prisma/client";
import { EngineConnectionManager } from "./engine-connection.manager";
import { NullEngineConnector } from "./engine-connector";

const mgr = () => new EngineConnectionManager(new NullEngineConnector());
const base = { provider: TelecomEngineType.KAMAILIO, correlationId: "cid" };

describe("EngineConnectionManager — honest, SSRF-guarded reachability", () => {
  it("UNCONFIGURED when no endpoint is set (no egress)", async () => {
    const r = await mgr().resolve({ ...base, endpoint: null, status: TelecomStatus.ACTIVE });
    expect(r.state).toBe("UNCONFIGURED");
    expect(r.endpointConfigured).toBe(false);
  });

  it("DISABLED when the engine is administratively disabled", async () => {
    const r = await mgr().resolve({ ...base, endpoint: "https://kam.telvyn.example", status: TelecomStatus.DISABLED });
    expect(r.state).toBe("DISABLED");
  });

  it("BLOCKED for an SSRF-unsafe endpoint — refused BEFORE any connector call", async () => {
    const r = await mgr().resolve({ ...base, endpoint: "http://169.254.169.254", status: TelecomStatus.ACTIVE });
    expect(r.state).toBe("BLOCKED");
    expect(r.detail).toMatch(/rejected/i);
  });

  it("UNVERIFIED for a valid public endpoint with the NullConnector (no live egress, never fake)", async () => {
    const r = await mgr().resolve({ ...base, endpoint: "https://kam.telvyn.example", status: TelecomStatus.ACTIVE });
    expect(r.state).toBe("UNVERIFIED");
    expect(r.probe?.contacted).toBe(false);
  });
});
