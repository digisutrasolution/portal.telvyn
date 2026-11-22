import { describe, expect, it } from "vitest";
import { CreateCarrierDto } from "./carriers.dto";

/**
 * Guards the Phase 12O-2az credential-type freeze: adding NODE_AGENT (ADR-0020) to
 * the Prisma enum must NOT make it attachable to a carrier. The carrier inline
 * credential accepts only its own (SIP_PASSWORD / CARRIER_API / ENGINE_API), never
 * an infrastructure credential type.
 */
const base = (credType: string) => ({
  name: "Acme SIP",
  credential: { type: credType, label: "k", secret: "s3cr3t" },
});

describe("carrier inline-credential type freeze (ADR-0020 / 12O-2az)", () => {
  it("accepts the carrier-attachable credential types", () => {
    for (const t of ["SIP_PASSWORD", "CARRIER_API", "ENGINE_API"]) {
      expect(CreateCarrierDto.safeParse(base(t)).success).toBe(true);
    }
  });

  it("rejects NODE_AGENT — a node credential can never be attached to a carrier", () => {
    const r = CreateCarrierDto.safeParse(base("NODE_AGENT"));
    expect(r.success).toBe(false);
  });

  it("rejects an unknown credential type", () => {
    expect(CreateCarrierDto.safeParse(base("TOTALLY_BOGUS")).success).toBe(false);
  });
});
