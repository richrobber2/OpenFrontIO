import { describe, expect, it } from "vitest";
import {
  sampleCoastalAccess,
  scoreTrainingSpawn,
} from "../../src/client/ai/SpawnStrategyPolicy";

describe("sampleCoastalAccess", () => {
  it("finds a useful ocean coast with bounded radial sampling", () => {
    const result = sampleCoastalAccess({
      originX: 50,
      originY: 50,
      isValidCoord: (x, y) => x >= 0 && y >= 0 && x < 100 && y < 100,
      tileAt: (x, y) => y * 100 + x,
      isOceanShore: (tile) => tile % 100 >= 65,
      openWaterDirections: () => 4,
      step: 5,
    });

    expect(result.distance).toBe(15);
    expect(result.openWaterDirections).toBe(4);
  });

  it("returns no coast when the bounded scan cannot reach one", () => {
    expect(
      sampleCoastalAccess({
        originX: 10,
        originY: 10,
        isValidCoord: () => true,
        tileAt: (x, y) => y * 100 + x,
        isOceanShore: () => false,
        openWaterDirections: () => 0,
        maximumDistance: 30,
      }).distance,
    ).toBeNull();
  });
});

describe("scoreTrainingSpawn", () => {
  const base = {
    neutralSpace: 500,
    nearbyTribes: 4,
    nationDistance: 80,
    tribeDistance: 13,
    tribeTroops: 10_000,
    openWaterDirections: 4,
  };

  it("prefers coast close enough to start piracy over an equal inland spawn", () => {
    expect(scoreTrainingSpawn({ ...base, coastDistance: 18 })).toBeGreaterThan(
      scoreTrainingSpawn({ ...base, coastDistance: null }),
    );
  });

  it("prefers a nearby buildable coast over a cramped shoreline", () => {
    expect(scoreTrainingSpawn({ ...base, coastDistance: 18 })).toBeGreaterThan(
      scoreTrainingSpawn({ ...base, coastDistance: 0 }),
    );
  });

  it("does not sacrifice a whole tribe cluster merely to touch the coast", () => {
    const coastal = scoreTrainingSpawn({
      ...base,
      nearbyTribes: 2,
      coastDistance: 18,
    });
    const richerInlandCluster = scoreTrainingSpawn({
      ...base,
      nearbyTribes: 6,
      coastDistance: null,
    });
    expect(richerInlandCluster).toBeGreaterThan(coastal);
  });
});
