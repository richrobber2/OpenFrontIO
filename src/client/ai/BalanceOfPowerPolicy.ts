export interface NeighborConflictCandidate {
  id: string;
  powerRatioToSelf: number;
  reserveRatio: number;
  activeWars: number;
  growthMomentum: number;
  hostilityToSelf: number;
  nuclearCapability: boolean;
  mirvProgress: number;
}

export interface BalanceOfPowerContext {
  ownReserveRatio: number;
  ownActiveWars: number;
  ownBorderExposure: number;
  diplomaticExposureRisk: number;
  candidates: NeighborConflictCandidate[];
}

export interface BalanceOfPowerDecision {
  action: "hold" | "encourage-conflict" | "support-weaker-side";
  primaryNationID?: string;
  secondaryNationID?: string;
  supportNationID?: string;
  commitmentCap: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Preserves a fragmented balance of power by encouraging costly wars between
 * neighboring rivals without allowing either participant to become dominant.
 */
export function chooseBalanceOfPowerAction(
  context: BalanceOfPowerContext,
): BalanceOfPowerDecision {
  if (
    context.ownActiveWars > 0 ||
    context.ownReserveRatio < 0.62 ||
    context.ownBorderExposure > 0.55 ||
    context.diplomaticExposureRisk > 0.45
  ) {
    return {
      action: "hold",
      commitmentCap: 0,
      reason: "own security or exposure risk is too high for indirect conflict",
    };
  }

  const viable = context.candidates
    .filter((nation) => nation.powerRatioToSelf >= 0.28)
    .filter((nation) => nation.powerRatioToSelf <= 1.2)
    .filter((nation) => nation.reserveRatio >= 0.22)
    .filter((nation) => nation.mirvProgress < 0.75)
    .sort((a, b) => b.powerRatioToSelf - a.powerRatioToSelf);

  let bestPair:
    | {
        stronger: NeighborConflictCandidate;
        weaker: NeighborConflictCandidate;
        score: number;
        imbalance: number;
      }
    | undefined;

  for (let i = 0; i < viable.length; i += 1) {
    for (let j = i + 1; j < viable.length; j += 1) {
      const a = viable[i];
      const b = viable[j];
      const stronger =
        a.powerRatioToSelf >= b.powerRatioToSelf ? a : b;
      const weaker = stronger === a ? b : a;
      const imbalance =
        stronger.powerRatioToSelf / Math.max(0.01, weaker.powerRatioToSelf);

      const mutualValue =
        Math.min(a.powerRatioToSelf, b.powerRatioToSelf) * 18 +
        (a.hostilityToSelf + b.hostilityToSelf) * 8 +
        (a.growthMomentum + b.growthMomentum) * 5;
      const existingWarPenalty = (a.activeWars + b.activeWars) * 3;
      const nuclearPenalty =
        (a.nuclearCapability ? 8 : 0) + (b.nuclearCapability ? 8 : 0);
      const runawayPenalty = imbalance > 1.65 ? (imbalance - 1.65) * 20 : 0;
      const score =
        mutualValue - existingWarPenalty - nuclearPenalty - runawayPenalty;

      if (bestPair === undefined || score > bestPair.score) {
        bestPair = { stronger, weaker, score, imbalance };
      }
    }
  }

  if (bestPair === undefined || bestPair.score < 8) {
    return {
      action: "hold",
      commitmentCap: 0,
      reason: "no safe rival pair would create a useful balance-of-power war",
    };
  }

  const exposure = clamp(context.diplomaticExposureRisk, 0, 1);
  const commitmentCap = clamp(
    0.12 - exposure * 0.08 - context.ownBorderExposure * 0.04,
    0.02,
    0.12,
  );

  if (bestPair.imbalance >= 1.35) {
    return {
      action: "support-weaker-side",
      primaryNationID: bestPair.stronger.id,
      secondaryNationID: bestPair.weaker.id,
      supportNationID: bestPair.weaker.id,
      commitmentCap,
      reason: "keep the conflict balanced so neither rival can snowball",
    };
  }

  return {
    action: "encourage-conflict",
    primaryNationID: bestPair.stronger.id,
    secondaryNationID: bestPair.weaker.id,
    commitmentCap,
    reason: "encourage two comparable rivals to spend strength on each other",
  };
}
