import { describe, expect, it, vi } from "vitest";
import { HealthEntityType } from "@prisma/client";
import { EngineHealthService } from "./engine-health.service";

/** A raw HealthEvent row (as Prisma would return it), including fields the view must NOT echo. */
function row(id: string, fromStatus: string | null, toStatus: string) {
  return {
    id,
    entityType: HealthEntityType.ENGINE,
    entityId: "eng-1",
    tenantId: null,
    fromStatus,
    toStatus,
    reason: "probe said so",
    correlationId: "corr-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeService(rows: ReturnType<typeof row>[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = { healthEvent: { findMany } } as unknown as ConstructorParameters<typeof EngineHealthService>[0];
  const connection = {} as unknown as ConstructorParameters<typeof EngineHealthService>[1];
  return { service: new EngineHealthService(prisma, connection), findMany };
}

describe("EngineHealthService.history", () => {
  it("scopes the query to the engine's events (newest-first cursor args) and returns a safe view", async () => {
    const { service, findMany } = makeService([row("1", null, "UNKNOWN")]);
    const page = await service.history("eng-1", { limit: 25 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: HealthEntityType.ENGINE, entityId: "eng-1" },
        take: 26, // limit + 1
        orderBy: { id: "desc" }, // uuidv7 → newest first
      }),
    );
    // The view carries only safe fields — never entityType / entityId / tenantId.
    expect(page.items[0]).toEqual({
      id: "1",
      fromStatus: null,
      toStatus: "UNKNOWN",
      reason: "probe said so",
      correlationId: "corr-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(page.items[0]).not.toHaveProperty("entityType");
    expect(page.items[0]).not.toHaveProperty("entityId");
    expect(page.items[0]).not.toHaveProperty("tenantId");
    expect(page.nextCursor).toBeNull();
  });

  it("emits a nextCursor when a full (limit+1) page is fetched", async () => {
    const { service } = makeService([row("a", null, "UNKNOWN"), row("b", "UNKNOWN", "HEALTHY")]);
    const page = await service.history("eng-1", { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("a");
    expect(page.nextCursor).toBe("a"); // last returned id
  });

  it("passes the cursor through when paging", async () => {
    const { service, findMany } = makeService([]);
    await service.history("eng-1", { limit: 25, cursor: "cur-99" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: "cur-99" }, skip: 1 }));
  });
});
