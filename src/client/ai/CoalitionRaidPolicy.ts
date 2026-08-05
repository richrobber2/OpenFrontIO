export interface CoalitionRaidTarget {
  id: string;
  nationReserveRatio: number;
  nationTerritoryRatio: number;
  coastalTroops: number;
  coastalBuildingValue: number;
  landingDefenseMultiplier: number;
  nearbyEnemyWarships: number;
  nearbyFriendlyWarships: number;
  samRetaliationRisk: number;
  wouldOpenNationWar: boolean;
}

export interface CoalitionRaidContext {
  availableFleetTroops: number;
  reserveFleetTroops: number;
  ownReserveRatio: number;
  ownBorderExposure: number;
  activeNationWars: number;
  allyStrengthRatio: number;
  allyReliability: number;
  allySharedEnemyCommitment: number;
  allyBorderAccessToUs: number;
  ticksSinceAllianceFormed: number;
  targets: CoalitionRaidTarget[];
}

export interface CoalitionRaidPlan {
  action: "hold" | "solo-raid" | "coordinate-raid";
  targetID?: string;
  troops?: number;
  allyCommitmentCap: number;
  betrayalReserveRatio: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Exploits weak coastal nations while preventing an ally from using the shared
 * offensive to expose and then betray us. Low reserve, small territory, and
 * valuable coastal structures increase raid value. Ally reliability and
 * reciprocal commitment determine whether coordination is safe.
 */
export function planCoalitionRaid(
  context: CoalitionRaidContext,
): CoalitionRaidPlan {
  const betrayalRisk = clamp(
    (1 - context.allyReliability) * 0.55 +
      context.allyBorderAccessToUs * 0.25 +
      Math.max(0, 0.45 - context.allySharedEnemyCommitment) * 0.45 +
      (context.ticksSinceAllianceFormed < 300 ? 0.15 : 0),
    0,
    1,
  );

  const betrayalReserveRatio = clamp(
    0.42 + betrayalRisk * 0.35 + context.ownBorderExposure * 0.18,
    0.42,
    0.82,
  );

  const reserveTroops = Math.max(
    context.reserveFleetTroops,
    context.availableFleetTroops * betrayalReserveRatio,
  );
  const spendableTroops = Math.max(
    0,
    context.availableFleetTroops - reserveTroops,
  );

  if (
    spendableTroops <= 0 ||
    context.ownReserveRatio < betrayalReserveRatio ||
    context.activeNationWars >= 2
  ) {
    return {
      action: "hold",
      allyCommitmentCap: 0,
      betrayalReserveRatio,
      reason: "reserve, border exposure, or existing wars make a coastal conspiracy unsafe",
    };
  }

  const candidates = context.targets
    .filter(
      (target) =>
        target.nearbyEnemyWarships <= target.nearbyFriendlyWarships + 1,
    )
    .map((target) => {
      const weakness = clamp(
        (1 - target.nationReserveRatio) * 0.65 +
          (1 - target.nationTerritoryRatio) * 0.35,
        0,
        1,
      );
      const requiredTroops = Math.ceil(
        Math.max(
          400,
          target.coastalTroops * target.landingDefenseMultiplier *
            (weakness >= 0.65 ? 1.04 : 1.14),
        ),
      );
      const nationWarPenalty = target.wouldOpenNationWar ? 18 : 0;
      const retaliationPenalty = clamp(target.samRetaliationRisk, 0, 1) * 22;
      const score =
        weakness * 55 +
        target.coastalBuildingValue * 17 -
        requiredTroops / 2_200 -
        nationWarPenalty -
        retaliationPenalty;
      return { target, weakness, requiredTroops, score };
    })
    .filter((candidate) => candidate.requiredTroops <= spendableTroops)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (best === undefined || best.score < 18) {
    return {
      action: "hold",
      allyCommitmentCap: 0,
      betrayalReserveRatio,
      reason: "no weak coastal nation can be raided efficiently without excessive risk",
    };
  }

  const coordinationSafe =
    betrayalRisk <= 0.38 &&
    context.allyReliability >= 0.68 &&
    context.allySharedEnemyCommitment >= 0.45 &&
    context.allyStrengthRatio >= 0.45;

  const allyCommitmentCap = coordinationSafe
    ? clamp(0.3 + context.allyReliability * 0.25, 0.3, 0.52)
    : 0;

  return {
    action: coordinationSafe ? "coordinate-raid" : "solo-raid",
    targetID: best.target.id,
    troops: Math.min(
      best.requiredTroops,
      Math.floor(context.availableFleetTroops * 0.38),
    ),
    allyCommitmentCap,
    betrayalReserveRatio,
    reason: coordinationSafe
      ? "collapse the weak coastal nation with reciprocal ally pressure while preserving betrayal reserves"
      : "raid the weak coastal nation alone because allied commitment is not trustworthy enough",
  };
}
