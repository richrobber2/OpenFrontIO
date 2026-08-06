import { describe, expect, it } from "vitest";
import {
  assessStrategicStrike,
  boundariesWithinRadius,
  STRATEGIC_STRIKE_COOLDOWN_TICKS,
} from "../../src/client/ai/StrategicWeaponsPolicy";

const base = {
  weapon: "nuke" as const,
  targetTroops: 900_000,
  targetStructures: 5,
  targetTerritoryShare: 0.18,
  targetActiveWars: 2,
  targetHasSamCoverage: false,
  targetIsWinning: true,
  targetIsAlly: false,
  ownReserveRatio: 0.65,
  ownActiveNationWars: 1,
  availableWeapons: 2,
  ticksSinceLastStrike: STRATEGIC_STRIKE_COOLDOWN_TICKS,
};

describe("assessStrategicStrike", () => {
  it("fires at a high-value leading enemy", () => {
    expect(assessStrategicStrike(base).fire).toBe(true);
  });

  it("never fires at an ally", () => {
    expect(assessStrategicStrike({ ...base, targetIsAlly: true }).fire).toBe(
      false,
    );
  });

  it("does not impose an extra global cooldown over silo reloads", () => {
    expect(
      assessStrategicStrike({ ...base, ticksSinceLastStrike: 40 }).fire,
    ).toBe(true);
  });

  it("conserves a last weapon against a low-value SAM-covered target", () => {
    const decision = assessStrategicStrike({
      ...base,
      targetTroops: 40_000,
      targetStructures: 0,
      targetTerritoryShare: 0.01,
      targetActiveWars: 0,
      targetHasSamCoverage: true,
      targetIsWinning: false,
      availableWeapons: 1,
    });
    expect(decision.fire).toBe(false);
  });

  it("values MIRVs more highly against SAM coverage than single nukes", () => {
    const nuke = assessStrategicStrike({ ...base, targetHasSamCoverage: true });
    const mirv = assessStrategicStrike({
      ...base,
      weapon: "mirv",
      targetHasSamCoverage: true,
    });
    expect(mirv.score).toBeGreaterThan(nuke.score);
  });

  it("rejects a valuable target when its blast reaches owned land", () => {
    const decision = assessStrategicStrike({
      ...base,
      ownCollateralTiles: 1,
    });

    expect(decision.fire).toBe(false);
    expect(decision.reasons).toContain(
      "the blast footprint reaches friendly territory or structures",
    );
  });

  it("rejects allied structures even when the center tile is hostile", () => {
    expect(
      assessStrategicStrike({
        ...base,
        alliedUnitsAtRisk: 1,
      }).fire,
    ).toBe(false);
  });

  it("detects MIRV warhead proximity without comparing every tile pair", () => {
    const points = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 100, y: 100 }],
      [3, { x: 12, y: 12 }],
      [4, { x: 50, y: 50 }],
    ]);
    const position = (tile: number) => points.get(tile)!;

    expect(
      boundariesWithinRadius({
        source: [1, 2],
        target: [3],
        radius: 18,
        position,
      }),
    ).toBe(true);
    expect(
      boundariesWithinRadius({
        source: [1, 2],
        target: [4],
        radius: 18,
        position,
      }),
    ).toBe(false);
  });
});
