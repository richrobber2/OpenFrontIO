import { describe, expect, it } from "vitest";
import { chooseRailEconomyPlan } from "../../src/client/ai/RailEconomyPolicy";

const base = {
  hasFactoryPair: true,
  factoryConnectionValue: 0.8,
  gold: 5_000,
  emergencyGoldFloor: 1_000,
  minimumPaybackMinutes: 8,
  candidates: [
    {
      id: "rail-city",
      distanceToFactoryA: 50,
      distanceToFactoryB: 55,
      isOnRailTrack: true,
      projectedGoldPerMinute: 300,
      buildCost: 1_200,
      overlapWithExistingCityCoverage: 0.05,
      threatenedBorderPressure: 0.1,
    },
  ],
};

describe("chooseRailEconomyPlan", () => {
  it("connects factories before placing track cities", () => {
    const decision = chooseRailEconomyPlan({
      ...base,
      hasFactoryPair: false,
      candidates: [],
    });
    expect(decision.action).toBe("connect-factories");
  });

  it("builds a city directly on a productive factory rail track", () => {
    const decision = chooseRailEconomyPlan(base);
    expect(decision.action).toBe("build-city");
    expect(decision.candidateID).toBe("rail-city");
  });

  it("rejects a nearby city when its tile is not part of the train track", () => {
    const decision = chooseRailEconomyPlan({
      ...base,
      candidates: [{ ...base.candidates[0], id: "nearby", isOnRailTrack: false }],
    });
    expect(decision.action).toBe("hold");
  });

  it("chooses an on-track city over a more profitable nearby off-track site", () => {
    const decision = chooseRailEconomyPlan({
      ...base,
      candidates: [
        {
          ...base.candidates[0],
          id: "off-track-rich",
          isOnRailTrack: false,
          projectedGoldPerMinute: 1_000,
        },
        base.candidates[0],
      ],
    });
    expect(decision.action).toBe("build-city");
    expect(decision.candidateID).toBe("rail-city");
  });

  it("rejects overlapping city coverage", () => {
    const decision = chooseRailEconomyPlan({
      ...base,
      candidates: [
        { ...base.candidates[0], overlapWithExistingCityCoverage: 0.6 },
      ],
    });
    expect(decision.action).toBe("hold");
  });

  it("rejects corridors with poor payback", () => {
    const decision = chooseRailEconomyPlan({
      ...base,
      candidates: [
        {
          ...base.candidates[0],
          projectedGoldPerMinute: 50,
          buildCost: 2_000,
        },
      ],
    });
    expect(decision.action).toBe("hold");
  });

  it("preserves the emergency gold floor", () => {
    const decision = chooseRailEconomyPlan({
      ...base,
      gold: 1_500,
    });
    expect(decision.action).toBe("hold");
  });
});
