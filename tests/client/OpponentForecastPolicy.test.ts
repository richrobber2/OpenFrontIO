import { describe, expect, it } from "vitest";
import {
  forecastOpponent,
  OpponentObservation,
} from "../../src/client/ai/OpponentForecastPolicy";

function observation(
  overrides: Partial<OpponentObservation> = {},
): OpponentObservation {
  return {
    tick: 100,
    troops: 60_000,
    maxTroops: 100_000,
    tiles: 1_000,
    gold: 100_000,
    incomingAttacks: 0,
    incomingTroops: 0,
    outgoingAttacks: 0,
    outgoingTroops: 0,
    cities: 1,
    factories: 1,
    ports: 0,
    silos: 0,
    warships: 0,
    allied: false,
    sharesBorder: true,
    ...overrides,
  };
}

describe("OpponentForecastPolicy", () => {
  it("detects and predicts a newly committed attack from raw deltas", () => {
    const forecast = forecastOpponent({
      id: "aggressor",
      previous: observation({ tick: 90, troops: 85_000 }),
      current: observation({
        troops: 55_000,
        outgoingAttacks: 1,
        outgoingTroops: 30_000,
      }),
      ownTroops: 70_000,
      ownMaxTroops: 100_000,
      ownTiles: 1_000,
    });

    expect(forecast.observedChoice).toBe("attack");
    expect(forecast.predictedChoice).toBe("attack");
    expect(forecast.projected.near.tick).toBe(220);
  });

  it("keeps allies in the threat model at a reduced, non-zero weight", () => {
    const hostile = forecastOpponent({
      id: "hostile",
      current: observation(),
      ownTroops: 60_000,
      ownMaxTroops: 100_000,
      ownTiles: 1_000,
    });
    const allied = forecastOpponent({
      id: "ally",
      current: observation({ allied: true }),
      ownTroops: 60_000,
      ownMaxTroops: 100_000,
      ownTiles: 1_000,
    });

    expect(allied.threat).toBeGreaterThan(0);
    expect(allied.threat).toBeLessThan(hostile.threat);
  });

  it("recognizes structure spending as an economic choice", () => {
    const forecast = forecastOpponent({
      id: "builder",
      previous: observation({ tick: 90, factories: 0, gold: 500_000 }),
      current: observation({ factories: 1, gold: 100_000 }),
      ownTroops: 60_000,
      ownMaxTroops: 100_000,
      ownTiles: 1_000,
    });

    expect(forecast.observedChoice).toBe("economy");
    expect(forecast.probabilities.economy).toBeGreaterThan(
      forecast.probabilities.expand,
    );
  });
});
