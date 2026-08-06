export type TroopEconomyAction =
  | "regenerate"
  | "pulse-expand"
  | "hold"
  | "attack";

export interface TroopEconomyContext {
  reserveRatio: number;
  reserveFloor: number;
  incomingTroopRatio: number;
  outgoingCommittedRatio: number;
  activeFronts: number;
  neutralLandAvailable: boolean;
  targetTroopAdvantage: number;
  targetValue: number;
  targetFortificationMultiplier: number;
}

export interface TroopEconomyDecision {
  action: TroopEconomyAction;
  maxCommitFraction: number;
  reason: string;
}

export interface MaxPushRiskContext {
  reserveRatio: number;
  commitFractionOfCurrent: number;
  activeFronts: number;
  defenderTroopRatio: number;
  takeSpeedMultiplier: number;
}

export interface MaxPushRiskDecision {
  allowed: boolean;
  reason: string;
}

/**
 * A max push roughly doubles capture speed, but it also exposes the homeland
 * while the committed squad is travelling. If the defender can meet most of
 * that squad, a wipe costs the captured land and the reserve used to defend
 * every other front. Treat the speed bonus as a gamble, not a default attack.
 */
export function assessMaxPushRisk(
  context: MaxPushRiskContext,
): MaxPushRiskDecision {
  if (context.takeSpeedMultiplier < 2) {
    return {
      allowed: true,
      reason: "the attack is not using the max-push speed gamble",
    };
  }

  const remainingReserve =
    context.reserveRatio * (1 - context.commitFractionOfCurrent);
  if (remainingReserve < 0.34) {
    return {
      allowed: false,
      reason:
        "a max push would expose the homeland below the regeneration reserve",
    };
  }
  if (context.activeFronts > 0) {
    return {
      allowed: false,
      reason: "a max push would leave an existing front uncovered",
    };
  }
  if (context.defenderTroopRatio >= 0.85) {
    return {
      allowed: false,
      reason:
        "the defender can meet most of the committed squad and risk wiping it",
    };
  }
  return {
    allowed: true,
    reason:
      "a max push has enough reserve and troop advantage to justify the two-times capture speed",
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Protects troop regeneration and survival before permitting another attack.
 * The caller should never commit more than maxCommitFraction of current troops.
 */
export function decideTroopEconomy(
  context: TroopEconomyContext,
): TroopEconomyDecision {
  const pressure =
    context.incomingTroopRatio + context.outgoingCommittedRatio * 0.7;
  const survivalFloor = Math.max(
    context.reserveFloor,
    0.34 + Math.min(0.18, context.activeFronts * 0.05),
  );

  if (context.reserveRatio <= survivalFloor || pressure >= 0.55) {
    return {
      action: context.incomingTroopRatio > 0.25 ? "hold" : "regenerate",
      maxCommitFraction: 0,
      reason:
        "reserve or combat pressure is too dangerous for another commitment",
    };
  }

  if (context.neutralLandAvailable) {
    const desiredPostLaunchReserve = Math.max(survivalFloor, 0.4);
    const maxCommitFraction = clamp(
      (context.reserveRatio - desiredPostLaunchReserve) /
        Math.max(0.01, context.reserveRatio),
      0,
      0.28,
    );
    return maxCommitFraction >= 0.08
      ? {
          action: "pulse-expand",
          maxCommitFraction,
          reason: "take cheap neutral land while preserving regeneration",
        }
      : {
          action: "regenerate",
          maxCommitFraction: 0,
          reason: "wait for a safe neutral expansion pulse",
        };
  }

  const effectiveAdvantage =
    context.targetTroopAdvantage /
    Math.max(1, context.targetFortificationMultiplier);
  const valueThreshold = 0.55 + context.activeFronts * 0.08;
  if (effectiveAdvantage < 1.3 || context.targetValue < valueThreshold) {
    return {
      action: "hold",
      maxCommitFraction: 0,
      reason:
        "target value does not justify the regeneration and fortification cost",
    };
  }

  const desiredPostLaunchReserve = Math.max(survivalFloor, 0.48);
  const maxCommitFraction = clamp(
    (context.reserveRatio - desiredPostLaunchReserve) /
      Math.max(0.01, context.reserveRatio),
    0,
    context.activeFronts === 0 ? 0.42 : 0.25,
  );

  return maxCommitFraction >= 0.12
    ? {
        action: "attack",
        maxCommitFraction,
        reason:
          "positive-value attack fits inside the protected reserve budget",
      }
    : {
        action: "regenerate",
        maxCommitFraction: 0,
        reason:
          "attack would leave too little reserve to regenerate or survive",
      };
}
