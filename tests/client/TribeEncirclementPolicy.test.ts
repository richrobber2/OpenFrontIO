import { describe, expect, it } from "vitest";
import { chooseTribeCapture } from "../../src/client/ai/TribeEncirclementPolicy";

const base = {
  tribeID: "tribe-1",
  tribeTiles: 80,
  tribeTroops: 4_000,
  perimeterTiles: 20,
  ownedPerimeterTiles: 10,
  neutralPerimeterTiles: 10,
  enemyPerimeterTiles: 0,
  ringCompletionTroopCost: 500,
  directAssaultTroopCost: 4_500,
  availableTroops: 8_000,
  reserveTroops: 3_000,
  competingNationDistance: 30,
  estimatedRingCompletionTicks: 80,
  estimatedCompetitorArrivalTicks: 300,
  captureTriggersOnFullEncirclement: true,
};

describe("chooseTribeCapture", () => {
  it("completes a cheap enclosure instead of paying the tribe combat cost", () => {
    const decision = chooseTribeCapture(base);
    expect(decision.action).toBe("complete-ring");
    expect(decision.maxTroops).toBe(500);
  });

  it("uses a direct assault when encirclement is not actually cheaper", () => {
    const decision = chooseTribeCapture({
      ...base,
      ringCompletionTroopCost: 2_500,
      directAssaultTroopCost: 4_000,
    });
    expect(decision.action).toBe("direct-assault");
  });

  it("holds when a nearby nation can steal the surrounded tribe", () => {
    const decision = chooseTribeCapture({
      ...base,
      competingNationDistance: 6,
      estimatedCompetitorArrivalTicks: 70,
    });
    expect(decision.action).toBe("hold");
    expect(decision.reason).toContain("steal");
  });

  it("preserves the troop reserve", () => {
    const decision = chooseTribeCapture({
      ...base,
      availableTroops: 3_200,
      reserveTroops: 3_000,
    });
    expect(decision.action).toBe("hold");
  });

  it("does not attempt the trick when encirclement does not trigger capture", () => {
    const decision = chooseTribeCapture({
      ...base,
      captureTriggersOnFullEncirclement: false,
    });
    expect(decision.action).toBe("direct-assault");
  });
});
