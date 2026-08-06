import { describe, expect, it } from "vitest";
import {
  applyActionOutcomeLearning,
  normalizeActionReward,
  scoreCounterfactualActionOutcome,
  scoreDelayedActionOutcome,
} from "../src/client/ai/ActionOutcomeLearning";

describe("delayed action outcome learning", () => {
  it("rewards an expansion that gains land without destroying reserves", () => {
    expect(
      scoreDelayedActionOutcome({
        action: "expand",
        startingTroops: 80_000,
        endingTroops: 75_000,
        maxTroops: 100_000,
        startingTiles: 100,
        endingTiles: 150,
        startingGold: 20_000,
        endingGold: 25_000,
        survived: true,
      }),
    ).toBeGreaterThan(0);
  });

  it("penalizes elimination and keeps learned genes bounded", () => {
    const reward = scoreDelayedActionOutcome({
      action: "attack",
      startingTroops: 100_000,
      endingTroops: 0,
      maxTroops: 100_000,
      startingTiles: 100,
      endingTiles: 0,
      startingGold: 0,
      endingGold: 0,
      survived: false,
    });
    expect(reward).toBe(-1);
    expect(
      applyActionOutcomeLearning(
        { aggression: -0.99, caution: 0, naval: 0 },
        "attack",
        reward,
        0,
      ).aggression,
    ).toBe(-1);
  });

  it("reduces update size as evidence accumulates", () => {
    const genes = { aggression: 0, caution: 0, naval: 0 };
    const early = applyActionOutcomeLearning(genes, "fleet", 1, 0);
    const mature = applyActionOutcomeLearning(genes, "fleet", 1, 99);
    expect(early.naval).toBeGreaterThan(mature.naval);
  });

  it("rewards only the gain above the action forecast", () => {
    const base = {
      action: "expand" as const,
      startingTroops: 80_000,
      endingTroops: 85_000,
      maxTroops: 100_000,
      startingTiles: 100,
      endingTiles: 120,
      startingGold: 0,
      endingGold: 0,
      survived: true,
    };
    expect(
      scoreCounterfactualActionOutcome({
        ...base,
        expectedTroops: 82_000,
        expectedTiles: 110,
      }),
    ).toBeGreaterThan(0);
    expect(
      scoreCounterfactualActionOutcome({
        ...base,
        expectedTroops: 90_000,
        expectedTiles: 130,
      }),
    ).toBeLessThan(0);
  });

  it("shares credit when several decisions overlap", () => {
    const genes = { aggression: 0, caution: 0, naval: 0 };
    const isolated = applyActionOutcomeLearning(genes, "attack", 1, 0, 1);
    const overlapping = applyActionOutcomeLearning(genes, "attack", 1, 0, 0.5);
    expect(isolated.aggression).toBeGreaterThan(overlapping.aggression);
  });

  it("learns an action baseline and centers repeated rewards", () => {
    const first = normalizeActionReward(0.4, { mean: 0, samples: 0 });
    expect(first.learningSignal).toBe(0.4);
    const repeated = normalizeActionReward(0.4, first.baseline);
    expect(repeated.learningSignal).toBe(0);
    const disappointment = normalizeActionReward(0.1, repeated.baseline);
    expect(disappointment.learningSignal).toBeLessThan(0);
  });

  it("regularizes a saturated gene when reward carries no information", () => {
    const result = applyActionOutcomeLearning(
      { aggression: 0, caution: 1, naval: 0 },
      "hold",
      0,
      100,
    );
    expect(result.caution).toBeLessThan(1);
  });
});
