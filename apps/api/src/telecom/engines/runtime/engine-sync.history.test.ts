import { describe, expect, it, vi } from "vitest";
import { ConfigChangeType } from "@prisma/client";
import { EngineSyncService } from "./engine-sync.service";

/** A raw TelecomConfigVersion row as Prisma returns it (newConfig is a VersionSnapshot JSON). */
function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: null,
    entityType: "engine",
    entityId: "eng-1",
    changeType: ConfigChangeType.UPDATE,
    previousConfig: { fingerprint: "prevFINGERPRINT0000" },
    newConfig: { kind: "desired", fingerprint: "newFINGERPRINT1111", short: "newFINGERPRI", summary: { carriers: 1, trunks: 2 } },
    actorId: "actor-1",
    correlationId: "corr-1",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeService(rows: ReturnType<typeof row>[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = { telecomConfigVersion: { findMany } } as unknown as ConstructorParameters<typeof EngineSyncService>[0];
  const stub = {} as never;
  return { service: new EngineSyncService(prisma, stub, stub, stub, stub), findMany };
}

describe("EngineSyncService.history", () => {
  it("scopes to the engine's config versions (newest-first cursor args) and returns a safe view", async () => {
    const { service, findMany } = makeService([row("1")]);
    const page = await service.history("eng-1", { limit: 25 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: "engine", entityId: "eng-1" },
        take: 26,
        orderBy: { id: "desc" },
      }),
    );
    expect(page.items[0]).toEqual({
      id: "1",
      changeType: "UPDATE",
      kind: "desired",
      version: "newFINGERPRI", // snapshot.short
      previousVersion: "prevFINGERPR", // shortFingerprint(previousConfig.fingerprint) = first 12
      summary: { carriers: 1, trunks: 2 },
      actorId: "actor-1",
      correlationId: "corr-1",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    // Never echoes raw snapshot internals / entity scoping.
    expect(page.items[0]).not.toHaveProperty("entityType");
    expect(page.items[0]).not.toHaveProperty("newConfig");
    expect(page.nextCursor).toBeNull();
  });

  it("tolerates a null previousConfig (first version) and emits nextCursor on a full page", async () => {
    const { service } = makeService([
      row("a", { previousConfig: null }),
      row("b"),
    ]);
    const page = await service.history("eng-1", { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("a");
    expect(page.items[0].previousVersion).toBeNull();
    expect(page.nextCursor).toBe("a");
  });

  it("passes the cursor through when paging", async () => {
    const { service, findMany } = makeService([]);
    await service.history("eng-1", { limit: 25, cursor: "cur-7" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: "cur-7" }, skip: 1 }));
  });
});
