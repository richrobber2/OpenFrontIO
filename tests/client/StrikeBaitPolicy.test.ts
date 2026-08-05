import { describe, expect, it } from "vitest";
import { evaluateStrikeBait } from "../../src/client/ai/StrikeBaitPolicy";

const base = {
  targetIsAlly: false,
  targetSamCoverage: 0.05,
  pathSamExposure: 0.05,
  targetStructureValue: 8,
  targetTroops: 1_500_000,
  targetReserveRatio: 0.55,
  targetIsReclaimingDamagedLand: false,
  targetCommittedTroops: 0,
  ownAvailableBombs: 2,
  ownReserveRatio: 0.62,
  ownActiveNationWars: 0,
  ticksSinceLastStrike: 300,
  damagedLandValue: 6,
};

describe("evaluateStrikeBait", () => {
  it("strikes an uncovered valuable target and waits", () => {
    const decision = evaluateStrikeBait(base);
    expect(decision.launchStrike).toBe(true);
    expect(decision.launchGroundAttack).toBe(false);
    expect(decision.waitForReclaim).toBe(true);
  });

  it("avoids targets or paths covered by SAMs", () => {
    const decision = evaluateStrikeBait({
      ...base,
      targetSamCoverage: 0.7,
    });
    expect(decision.launchStrike).toBe(false);
    expect(decision.reason).toContain("SAM");
  });

  it("attacks when reclaiming troops expose the enemy reserve", () => {
    const decision = evaluateStrikeBait({
      ...base,
      targetIsReclaimingDamagedLand: true,
      targetCommittedTroops: 500_000,
      targetReserveRatio: 0.36,
    });
    expect(decision.launchGroundAttack).toBe(true);
    expect(decision.attackCommitmentRatio).toBeGreaterThanOrEqual(0.2);
    expect(decision.attackCommitmentRatio).toBeLessThanOrEqual(0.42);
  });

  it("keeps waiting when the reclaim commitment is still small", () => {
    const decision = evaluateStrikeBait({
      ...base,
      targetIsReclaimingDamagedLand: true,
      targetCommittedTroops: 100_000,
      targetReserveRatio: 0.7,
    });
    expect(decision.launchGroundAttack).toBe(false);
    expect(decision.waitForReclaim).toBe(true);
  });

  it("does not spring the trap while strategically overloaded", () => {
    const decision = evaluateStrikeBait({
      ...base,
      targetIsReclaimingDamagedLand: true,
      targetCommittedTroops: 600_000,
      targetReserveRatio: 0.3,
      ownReserveRatio: 0.4,
      ownActiveNationWars: 2,
    });
    expect(decision.launchGroundAttack).toBe(false);
  });

  it("never targets an ally", () => {
    const decision = evaluateStrikeBait({
      ...base,
      targetIsAlly: true,
    });
    expect(decision.launchStrike).toBe(false);
    expect(decision.launchGroundAttack).toBe(false);
  });
});
