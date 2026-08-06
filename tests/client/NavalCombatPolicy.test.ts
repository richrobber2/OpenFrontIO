import { describe, expect, it } from "vitest";
import {
  fleetCombatPower,
  NAVAL_CLASH_ADVANTAGE,
  selectWarshipDeployment,
  warshipCombatPower,
  warshipHealthRatio,
} from "../../src/client/ai/NavalCombatPolicy";

describe("NavalCombatPolicy", () => {
  it("uses veterancy-adjusted maximum health", () => {
    expect(warshipHealthRatio(100, 100, 3, 20)).toBeCloseTo(0.625);
    expect(warshipHealthRatio(160, 100, 3, 20)).toBe(1);
  });

  it("combines veteran durability and shell damage", () => {
    expect(
      warshipCombatPower({ health: 160, veterancy: 3 }, 100, 20),
    ).toBeCloseTo(2.56);
  });

  it("adds the strength of every hostile warship in a clash", () => {
    expect(
      fleetCombatPower(
        [
          { health: 100, veterancy: 0 },
          { health: 120, veterancy: 1 },
          { health: 80, veterancy: 2 },
        ],
        100,
        20,
      ),
    ).toBeCloseTo(3.56);
  });

  it("rejects critically damaged ships and meets target combat power", () => {
    const selected = selectWarshipDeployment(
      [
        { id: 1, health: 20, veterancy: 3, distanceSquared: 10 },
        { id: 2, health: 100, veterancy: 0, distanceSquared: 20 },
        { id: 3, health: 120, veterancy: 2, distanceSquared: 30 },
      ],
      1.5,
      3,
      1.15,
      100,
      20,
      20,
    );
    expect(selected.map((ship) => ship.id)).not.toContain(1);
    expect(selected.length).toBe(2);
  });

  it("does not commit a fleet that cannot reach the clash advantage", () => {
    expect(
      selectWarshipDeployment(
        [
          { id: 1, health: 70, veterancy: 0, distanceSquared: 10 },
          { id: 2, health: 80, veterancy: 0, distanceSquared: 20 },
        ],
        3,
        2,
        NAVAL_CLASH_ADVANTAGE,
        100,
        20,
        20,
      ),
    ).toEqual([]);
  });
});
