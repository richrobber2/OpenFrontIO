import { describe, expect, test } from "vitest";
import { getUnitRenderSubsets } from "../../src/client/render/frame/UnitSubsetRegistry";
import type { UnitState } from "../../src/client/render/types";
import { UnitSubsetIndex } from "../../src/client/view/UnitSubsetIndex";
import { UnitType } from "../../src/core/game/Game";

const BUILDING_COUNT = 1_200;

function state(id: number, unitType: UnitType): UnitState {
  return {
    id,
    unitType,
    ownerID: 1,
    lastOwnerID: null,
    pos: id,
    lastPos: id,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
  };
}

describe("Rust-backed UnitSubsetIndex building stress", () => {
  test("keeps 1200 completed cities out of mobile and progress hot loops", () => {
    expect(BUILDING_COUNT).toBeGreaterThanOrEqual(1_000);

    const states = new Map<number, UnitState>();
    const updates: Array<{
      id: number;
      unitType: string;
      isActive: boolean;
    }> = [];

    for (let id = 1; id <= BUILDING_COUNT; id++) {
      states.set(id, state(id, UnitType.City));
      updates.push({ id, unitType: UnitType.City, isActive: true });
    }

    const index = new UnitSubsetIndex();
    index.applyUpdates(updates, states);

    expect(index.structures.size).toBe(BUILDING_COUNT);
    expect(index.mobile.size).toBe(0);
    expect(index.warships.size).toBe(0);
    expect(index.progressStructures.size).toBe(0);

    const registered = getUnitRenderSubsets(states);
    expect(registered).toBe(index);
    expect(registered?.structures.size).toBe(BUILDING_COUNT);

    // A city only enters the progress hot set while it actually needs a bar.
    const building = states.get(1)!;
    building.underConstruction = true;
    building.constructionStartTick = 0;
    index.applyUpdates(
      [{ id: 1, unitType: UnitType.City, isActive: true }],
      states,
    );
    expect(index.progressStructures.size).toBe(1);

    // SAM/Silo stay in the progress set because readiness advances with tick time.
    const samId = BUILDING_COUNT + 1;
    states.set(samId, state(samId, UnitType.SAMLauncher));
    index.applyUpdates(
      [{ id: samId, unitType: UnitType.SAMLauncher, isActive: true }],
      states,
    );
    expect(index.structures.size).toBe(BUILDING_COUNT + 1);
    expect(index.progressStructures.size).toBe(2);

    // Warship health/veterancy bars use their own tiny mobile subset.
    const warshipId = BUILDING_COUNT + 2;
    const warship = state(warshipId, UnitType.Warship);
    warship.health = 100;
    states.set(warshipId, warship);
    index.applyUpdates(
      [{ id: warshipId, unitType: UnitType.Warship, isActive: true }],
      states,
    );
    expect(index.mobile.size).toBe(1);
    expect(index.warships.size).toBe(1);

    // Deactivation removes membership without requiring a full-map rebuild.
    building.isActive = false;
    index.applyUpdates(
      [{ id: 1, unitType: UnitType.City, isActive: false }],
      states,
    );
    expect(index.structures.size).toBe(BUILDING_COUNT);
    expect(index.progressStructures.size).toBe(1);
  });
});
