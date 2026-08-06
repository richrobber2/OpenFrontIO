import { describe, expect, it } from "vitest";
import { isMissileAtlasColumn } from "../../../src/client/render/gl/utils/UnitAtlasClassification";

describe("isMissileAtlasColumn", () => {
  it("keeps boats and trains in the ground pass", () => {
    expect([0, 1, 2, 9, 10, 11].some(isMissileAtlasColumn)).toBe(false);
  });

  it("keeps every projectile atlas column in the missile pass", () => {
    expect([3, 4, 5, 6, 7, 8].every(isMissileAtlasColumn)).toBe(true);
  });
});
