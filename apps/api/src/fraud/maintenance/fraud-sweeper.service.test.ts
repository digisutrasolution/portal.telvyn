import { describe, it, expect, vi } from "vitest";
import { FraudSweeperService } from "./fraud-sweeper.service";
import type { SpendReservationService } from "../reservations/spend-reservation.service";
import type { VelocityCounterService } from "../counters/velocity-counter.service";

function make(expireDue: ReturnType<typeof vi.fn>, releaseConcurrent = vi.fn().mockResolvedValue(undefined)) {
  const reservations = { expireDue } as unknown as SpendReservationService;
  const counters = { releaseConcurrent } as unknown as VelocityCounterService;
  return { svc: new FraudSweeperService(reservations, counters), releaseConcurrent };
}

describe("FraudSweeperService.sweep", () => {
  it("expires holds and releases one concurrent-gauge count per expired call", async () => {
    // t1 leaked two calls, t2 one.
    const { svc, releaseConcurrent } = make(vi.fn().mockResolvedValue(["t1", "t1", "t2"]));
    expect(await svc.sweep()).toEqual({ expiredReservations: 3, concurrentReleased: 3 });
    expect(releaseConcurrent).toHaveBeenCalledTimes(3);
    expect(releaseConcurrent).toHaveBeenNthCalledWith(1, "t1");
    expect(releaseConcurrent).toHaveBeenNthCalledWith(2, "t1");
    expect(releaseConcurrent).toHaveBeenNthCalledWith(3, "t2");
  });

  it("is a no-op when nothing is overdue", async () => {
    const { svc, releaseConcurrent } = make(vi.fn().mockResolvedValue([]));
    expect(await svc.sweep()).toEqual({ expiredReservations: 0, concurrentReleased: 0 });
    expect(releaseConcurrent).not.toHaveBeenCalled();
  });
});
