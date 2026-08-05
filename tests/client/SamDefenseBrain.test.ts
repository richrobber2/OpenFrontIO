import { describe, expect, it } from "vitest";
import { evaluateStrategicSurvival } from "../../src/client/ai/StrategicSurvivalPolicy";

const base = {
  enemySiloCount: 2,
  incomingStrategicWeapons: 0,
  samCoverageRatio: 0.2,
  criticalLandSamCoverageRatio: 0.2,
  criticalStructureClustering: 0.7,
  recentBlastRisk: 0,
  gold: 4_000_000,
  samCost: 1_500_000,
  activeAttackCommitmentRatio: 0.2,
  reserveRatio: 0.75,
};

describe("SAM defense brain scenarios", () => {
  it("builds coverage when strategic structures are exposed", () => {
    const decision = evaluateStrategicSurvival(base);
    expect(decision.buildSam).toBe(true);
    expect(decision.disperseCriticalStructures).toBe(true);
  });

  it("prioritizes immediate interception over offensive commitments", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      incomingStrategicWeapons: 1,
      activeAttackCommitmentRatio: 0.8,
    });
    expect(decision.reduceAttackCommitments).toBe(true);
    expect(decision.reason).toContain("incoming strategic strike");
  });

  it("does not spend on SAMs when coverage and threat are already low", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      enemySiloCount: 0,
      samCoverageRatio: 0.9,
      criticalLandSamCoverageRatio: 0.9,
      criticalStructureClustering: 0.1,
    });
    expect(decision.buildSam).toBe(false);
    expect(decision.mirvStrategy).toBe("ignore");
  });
});
