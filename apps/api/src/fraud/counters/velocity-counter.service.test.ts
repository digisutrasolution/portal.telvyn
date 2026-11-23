import { describe, it, expect, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { VelocityCounterService } from "./velocity-counter.service";
import type { RedisService } from "@/infra/redis.service";

function makeService(client: Record<string, unknown>) {
  const redis = { client } as unknown as RedisService;
  return new VelocityCounterService(redis);
}

describe("VelocityCounterService.read", () => {
  it("returns current counts, defaulting missing keys to 0", async () => {
    const svc = makeService({ mget: vi.fn().mockResolvedValue(["5", null, "100", "2"]) });
    expect(await svc.read("t1")).toEqual({
      CALLS_PER_MINUTE: 5,
      CALLS_PER_HOUR: 0,
      CALLS_PER_DAY: 100,
      CONCURRENT_CALLS: 2,
    });
  });

  it("fails closed (ServiceUnavailable) when Redis is unreachable", async () => {
    const svc = makeService({ mget: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(svc.read("t1")).rejects.toThrow(ServiceUnavailableException);
  });

  it("never returns a negative concurrent count", async () => {
    const svc = makeService({ mget: vi.fn().mockResolvedValue([null, null, null, "-3"]) });
    expect((await svc.read("t1")).CONCURRENT_CALLS).toBe(0);
  });
});

describe("VelocityCounterService.recordCall", () => {
  it("increments all three windows and sets a TTL only on a window's first hit", async () => {
    const incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(5).mockResolvedValueOnce(1);
    const expire = vi.fn().mockResolvedValue(1);
    const svc = makeService({ incr, expire });
    await svc.recordCall("t1");
    expect(incr).toHaveBeenCalledTimes(3);
    expect(expire).toHaveBeenCalledTimes(2); // only the windows that became 1
  });

  it("fails closed when Redis is unreachable", async () => {
    const svc = makeService({ incr: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(svc.recordCall("t1")).rejects.toThrow(ServiceUnavailableException);
  });
});

describe("VelocityCounterService concurrent gauge", () => {
  it("acquire increments the gauge", async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const svc = makeService({ incr });
    expect(await svc.acquireConcurrent("t1")).toBe(1);
  });

  it("release runs the compare-and-floor script (best-effort, never throws)", async () => {
    const evalFn = vi.fn().mockResolvedValue(0);
    const svc = makeService({ eval: evalFn });
    await expect(svc.releaseConcurrent("t1")).resolves.toBeUndefined();
    expect(evalFn).toHaveBeenCalledOnce();
  });

  it("release swallows a Redis error (self-heals later)", async () => {
    const svc = makeService({ eval: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(svc.releaseConcurrent("t1")).resolves.toBeUndefined();
  });
});
