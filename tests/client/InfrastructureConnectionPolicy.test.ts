import { describe, expect, it } from "vitest";
import { isWithinRailConnectionRange } from "../../src/client/ai/InfrastructureConnectionPolicy";

describe("isWithinRailConnectionRange", () => {
  it("accepts only the engine's usable minimum-to-maximum rail band", () => {
    const connected = (distance: number) =>
      isWithinRailConnectionRange({
        distanceSquared: distance ** 2,
        minimumRange: 20,
        maximumRange: 100,
      });

    expect(connected(20)).toBe(false);
    expect(connected(21)).toBe(true);
    expect(connected(100)).toBe(true);
    expect(connected(101)).toBe(false);
  });

  it("rejects invalid measurements and range definitions", () => {
    expect(
      isWithinRailConnectionRange({
        distanceSquared: Number.POSITIVE_INFINITY,
        minimumRange: 20,
        maximumRange: 100,
      }),
    ).toBe(false);
    expect(
      isWithinRailConnectionRange({
        distanceSquared: 50 ** 2,
        minimumRange: 100,
        maximumRange: 20,
      }),
    ).toBe(false);
  });
});
