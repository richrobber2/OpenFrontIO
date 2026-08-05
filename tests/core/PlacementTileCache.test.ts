import { describe, expect, it } from "vitest";
import { placementTilesExcluding } from "../../src/core/execution/nation/PlacementTileCache";

describe("placementTilesExcluding", () => {
  it("reuses the snapshot for ordinary candidate tiles", () => {
    const snapshot = new Set([1, 2, 3]);
    expect(placementTilesExcluding(snapshot, 9)).toBe(snapshot);
  });

  it("omits a stacked candidate without mutating the snapshot", () => {
    const snapshot = new Set([1, 2, 3]);
    expect([...placementTilesExcluding(snapshot, 2)]).toEqual([1, 3]);
    expect([...snapshot]).toEqual([1, 2, 3]);
  });
});
