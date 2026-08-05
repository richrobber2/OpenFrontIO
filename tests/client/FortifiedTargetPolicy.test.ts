import { describe, expect, it } from "vitest";
import { evaluateFortifiedTarget } from "../../src/client/ai/FortifiedTargetPolicy";

const base = {
  troopAdvantage: 2,
  terrainDefenseMultiplier: 1,
  defensePostCoverage: 0,
  estimatedTicks: 240,
  coastalStructureValue: 0,
  inlandStructureValue: 20,
  borderWidth: 8,
  alternateTargets: 0,
};

describe("evaluateFortifiedTarget", () => {
  it("requires much more advantage against defense-post coverage", () => {
    const result = evaluateFortifiedTarget({
      ...base,
      defensePostCoverage: 1,
    });
    expect(result.requiredAdvantage).toBeGreaterThanOrEqual(6);
    expect(result.attack).toBe(false);
  });

  it("prefers a coastal raid when valuable buildings are exposed", () => {
    const result = evaluateFortifiedTarget({
      ...base,
      defensePostCoverage: 0.5,
      coastalStructureValue: 12,
    });
    expect(result.preferCoastalRaid).toBe(true);
    expect(result.attack).toBe(false);
  });

  it("rejects very long conquests", () => {
    const result = evaluateFortifiedTarget({
      ...base,
      troopAdvantage: 10,
      estimatedTicks: 700,
    });
    expect(result.attack).toBe(false);
  });

  it("allows a valuable unfortified target with enough advantage", () => {
    const result = evaluateFortifiedTarget(base);
    expect(result.attack).toBe(true);
  });
});
