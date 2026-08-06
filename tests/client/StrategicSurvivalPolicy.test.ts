import { describe, expect, it } from "vitest";
import { evaluateStrategicSurvival } from "../../src/client/ai/StrategicSurvivalPolicy";

const base = {
  enemySiloCount: 1,
  incomingStrategicWeapons: 0,
  samCoverageRatio: 0.75,
  criticalLandSamCoverageRatio: 0.75,
  criticalStructureClustering: 0.25,
  recentBlastRisk: 0,
  gold: 2_000,
  samCost: 1_000,
  activeAttackCommitmentRatio: 0.2,
  reserveRatio: 0.7,
};

describe("StrategicSurvivalPolicy", () => {
  it("builds SAM coverage when enemy silos create an uncovered threat", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      enemySiloCount: 2,
      samCoverageRatio: 0.2,
      criticalLandSamCoverageRatio: 0.2,
    });

    expect(decision.buildSam).toBe(true);
    expect(decision.emergencyGoldFloor).toBe(1_250);
  });

  it("cuts attack commitments when a strike is incoming", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      incomingStrategicWeapons: 1,
      gold: 500,
      activeAttackCommitmentRatio: 0.65,
      reserveRatio: 0.3,
    });

    expect(decision.reduceAttackCommitments).toBe(true);
    expect(decision.reason).toContain("incoming strategic strike");
  });

  it("disperses clustered critical structures and avoids blast zones", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      criticalStructureClustering: 0.8,
      recentBlastRisk: 0.7,
      gold: 500,
    });

    expect(decision.disperseCriticalStructures).toBe(true);
    expect(decision.avoidRecentBlastArea).toBe(true);
  });

  it("does not waste gold on redundant SAM coverage", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      samCoverageRatio: 0.9,
      criticalLandSamCoverageRatio: 0.9,
      criticalStructureClustering: 0.1,
      gold: 5_000,
    });

    expect(decision.buildSam).toBe(false);
  });

  it("blocks provocation when retaliation would destroy too much land", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      provokingNuclearNation: true,
      criticalLandSamCoverageRatio: 0.5,
      projectedRetaliationLandLossRatio: 0.28,
      reserveRatio: 0.4,
    });

    expect(decision.allowNuclearProvocation).toBe(false);
    expect(decision.reduceAttackCommitments).toBe(true);
  });

  it("commits to elimination when the rival can be finished before MIRV", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      provokingNuclearNation: true,
      enemyMirvProgress: 0.7,
      estimatedTicksUntilEnemyMirv: 800,
      estimatedTicksToEliminateEnemy: 500,
      eliminationConfidence: 0.82,
      criticalLandSamCoverageRatio: 0.8,
      reserveRatio: 0.7,
    });

    expect(decision.mirvStrategy).toBe("eliminate");
    expect(decision.allowNuclearProvocation).toBe(true);
    expect(decision.reason).toContain("eliminated before MIRV");
  });

  it("avoids escalation when MIRV arrives before a reliable elimination", () => {
    const decision = evaluateStrategicSurvival({
      ...base,
      provokingNuclearNation: true,
      enemyMirvProgress: 0.85,
      estimatedTicksUntilEnemyMirv: 350,
      estimatedTicksToEliminateEnemy: 700,
      eliminationConfidence: 0.55,
      criticalLandSamCoverageRatio: 0.7,
    });

    expect(decision.mirvStrategy).toBe("avoid");
    expect(decision.reduceAttackCommitments).toBe(true);
    expect(decision.emergencyGoldFloor).toBe(2_250);
  });
});
