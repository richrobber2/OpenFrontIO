import { describe, expect, it } from "vitest";
import { validVisualAiBrainProfile } from "../../src/server/VisualAiBrainStore";

const action = {
  tick: 6_754,
  action: "defend",
  reserveRatio: 0.13,
  enemyRatio: 18,
  expectedTroops: 20_000,
  expectedTiles: 100,
  actualTroops: 17_713,
  actualTiles: 109,
  error: 0.42,
};

describe("VisualAiBrainStore", () => {
  it("accepts numeric learning genes with bounded action history", () => {
    expect(
      validVisualAiBrainProfile({
        saveRevision: 11_857,
        mutationGeneration: 46,
        aggressionGene: 0.5,
        actionHistory: [action],
      }),
    ).toBe(true);
  });

  it("accepts the complete persisted outcome schema", () => {
    expect(
      validVisualAiBrainProfile({
        saveRevision: 14_874,
        matches: 51,
        wins: 4,
        recentMatchResults: ["loss", "win"],
        actionRewardBaselines: {
          attack: { mean: 0.1, samples: 10 },
          expand: { mean: 0.2, samples: 20 },
          fleet: { mean: -0.1, samples: 30 },
          defend: { mean: 0.3, samples: 40 },
          hold: { mean: 0, samples: 50 },
        },
        actionHistory: [
          {
            ...action,
            startingGold: 100_000,
            startingTiles: 10_000,
            startingTroops: 500_000,
            startingMaxTroops: 1_000_000,
            settleTick: 6_800,
            outcomeReward: 0.25,
            attributionWeight: 0.8,
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects malformed result ledgers and incomplete baselines", () => {
    expect(
      validVisualAiBrainProfile({
        saveRevision: 1,
        recentMatchResults: ["win", "draw"],
      }),
    ).toBe(false);
    expect(
      validVisualAiBrainProfile({
        saveRevision: 1,
        actionRewardBaselines: { attack: { mean: 0, samples: 1 } },
      }),
    ).toBe(false);
  });

  it("rejects unknown action fields and unbounded history", () => {
    expect(
      validVisualAiBrainProfile({
        saveRevision: 1,
        actionHistory: [{ ...action, injected: 1 }],
      }),
    ).toBe(false);
    expect(
      validVisualAiBrainProfile({
        saveRevision: 1,
        actionHistory: Array.from({ length: 129 }, () => action),
      }),
    ).toBe(false);
  });
});
