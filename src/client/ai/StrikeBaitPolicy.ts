export interface StrikeBaitContext {
  targetIsAlly: boolean;
  targetSamCoverage: number;
  pathSamExposure: number;
  targetStructureValue: number;
  targetTroops: number;
  targetReserveRatio: number;
  targetIsReclaimingDamagedLand: boolean;
  targetCommittedTroops: number;
  ownAvailableBombs: number;
  ownReserveRatio: number;
  ownActiveNationWars: number;
  ticksSinceLastStrike: number;
  damagedLandValue: number;
}

export interface StrikeBaitDecision {
  launchStrike: boolean;
  launchGroundAttack: boolean;
  waitForReclaim: boolean;
  attackCommitmentRatio: number;
  score: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Uses an uncovered strategic strike to create a reclaim trap. The AI avoids
 * SAM-covered targets, waits while the enemy rebuilds or retakes the damaged
 * area, then attacks after enemy troops are committed and reserves are lower.
 */
export function evaluateStrikeBait(
  context: StrikeBaitContext,
): StrikeBaitDecision {
  if (context.targetIsAlly) {
    return {
      launchStrike: false,
      launchGroundAttack: false,
      waitForReclaim: false,
      attackCommitmentRatio: 0,
      score: -100,
      reason: "target is allied",
    };
  }

  const samRisk = Math.max(
    clamp(context.targetSamCoverage, 0, 1),
    clamp(context.pathSamExposure, 0, 1),
  );
  const canStrike =
    context.ownAvailableBombs > 0 &&
    context.ticksSinceLastStrike >= 160 &&
    samRisk < 0.25;

  const strikeValue =
    Math.min(6, context.targetStructureValue * 0.8) +
    Math.min(4, context.targetTroops / 750_000) +
    Math.min(3, context.damagedLandValue * 0.6) -
    samRisk * 14;

  if (!context.targetIsReclaimingDamagedLand) {
    if (canStrike && strikeValue >= 6) {
      return {
        launchStrike: true,
        launchGroundAttack: false,
        waitForReclaim: true,
        attackCommitmentRatio: 0,
        score: strikeValue,
        reason: "strike an uncovered valuable target and wait for the reclaim response",
      };
    }

    return {
      launchStrike: false,
      launchGroundAttack: false,
      waitForReclaim: canStrike && context.damagedLandValue > 0,
      attackCommitmentRatio: 0,
      score: strikeValue,
      reason:
        samRisk >= 0.25
          ? "SAM exposure makes the strike inefficient"
          : "wait for a more valuable uncovered target or enemy reclaim",
    };
  }

  const committedRatio =
    context.targetCommittedTroops / Math.max(1, context.targetTroops);
  const enemyExposed =
    committedRatio >= 0.22 || context.targetReserveRatio <= 0.42;
  const ownSafe =
    context.ownReserveRatio >= 0.48 && context.ownActiveNationWars <= 1;

  if (enemyExposed && ownSafe) {
    const commitment = clamp(
      0.18 + committedRatio * 0.35 + (0.42 - context.targetReserveRatio) * 0.3,
      0.2,
      0.42,
    );
    return {
      launchStrike: false,
      launchGroundAttack: true,
      waitForReclaim: false,
      attackCommitmentRatio: commitment,
      score: strikeValue + committedRatio * 12,
      reason: "enemy committed troops to reclaim damaged land and exposed its reserve",
    };
  }

  return {
    launchStrike: false,
    launchGroundAttack: false,
    waitForReclaim: true,
    attackCommitmentRatio: 0,
    score: strikeValue,
    reason: "enemy reclaim has not exposed enough troops yet",
  };
}
