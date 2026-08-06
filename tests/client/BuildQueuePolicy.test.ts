import { describe, expect, it } from "vitest";
import { planBuildQueue } from "../../src/client/ai/BuildQueuePolicy";

const base = {
  gold: 100_000,
  emergencyGoldFloor: 20_000,
  maximumQueuedPlacements: 4,
  actionCapacity: 4,
  candidates: [
    { id: "factory-a", kind: "factory" as const, cost: 20_000, strategicScore: 90 },
    { id: "city-a", kind: "city" as const, cost: 10_000, strategicScore: 60 },
    { id: "city-b", kind: "city" as const, cost: 10_000, strategicScore: 55 },
    { id: "port-a", kind: "port" as const, cost: 30_000, strategicScore: 70 },
  ],
};

describe("planBuildQueue", () => {
  it("queues several placements when treasury exceeds one action", () => {
    const plan = planBuildQueue(base);
    expect(plan.queued.length).toBeGreaterThan(1);
    expect(plan.committedGold).toBeLessThanOrEqual(80_000);
    expect(plan.remainingGold).toBeGreaterThanOrEqual(20_000);
  });

  it("never spends below the emergency reserve", () => {
    const plan = planBuildQueue({ ...base, gold: 25_000 });
    expect(plan.committedGold).toBeLessThanOrEqual(5_000);
    expect(plan.remainingGold).toBeGreaterThanOrEqual(20_000);
  });

  it("obeys action capacity", () => {
    const plan = planBuildQueue({ ...base, actionCapacity: 2 });
    expect(plan.queued).toHaveLength(2);
  });

  it("does not queue conflicting placements", () => {
    const plan = planBuildQueue({
      ...base,
      candidates: [
        {
          id: "city-left",
          kind: "city",
          cost: 10_000,
          strategicScore: 80,
          conflictGroup: "tile-cluster-1",
        },
        {
          id: "factory-left",
          kind: "factory",
          cost: 20_000,
          strategicScore: 75,
          conflictGroup: "tile-cluster-1",
        },
        {
          id: "city-right",
          kind: "city",
          cost: 10_000,
          strategicScore: 70,
          conflictGroup: "tile-cluster-2",
        },
      ],
    });
    expect(plan.queued.filter((item) => item.conflictGroup === "tile-cluster-1")).toHaveLength(1);
    expect(plan.queued.some((item) => item.id === "city-right")).toBe(true);
  });

  it("keeps low-value placements out of the batch", () => {
    const plan = planBuildQueue({
      ...base,
      candidates: [
        ...base.candidates,
        { id: "bad-city", kind: "city", cost: 1_000, strategicScore: 0 },
      ],
    });
    expect(plan.queued.some((item) => item.id === "bad-city")).toBe(false);
  });
});
