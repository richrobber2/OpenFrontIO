export interface CoastalRaidTarget {
  id: string;
  coastalTroops: number;
  coastalBuildingValue: number;
  landingDefenseMultiplier: number;
  distanceFromFriendlyCoast: number;
  nearbyEnemyWarships: number;
  nearbyFriendlyWarships: number;
  friendlyPortProtection?: boolean;
  wouldOpenNationWar: boolean;
}

export interface CoastalRaidContext {
  availableFleetTroops: number;
  reserveFleetTroops: number;
  activeBoatRaids: number;
  maxBoatRaids: number;
  targets: CoastalRaidTarget[];
}

export interface CoastalRaidPlan {
  action: "hold" | "raid";
  targetID?: string;
  troops?: number;
  reason: string;
}

export interface BoatPositionContext {
  distanceFromFriendlyCoast: number;
  distanceToUsefulCoastalTarget: number | null;
  nearbyEnemyWarships: number;
  nearbyFriendlyWarships: number;
  insideFriendlyPort?: boolean;
  carryingTroops: number;
}

export type BoatPositionDecision =
  | "hold-near-coast"
  | "hold-in-port"
  | "approach-target"
  | "retreat";

const hasTwoToOneNavalSuperiority = (
  friendlyWarships: number,
  enemyWarships: number,
): boolean =>
  enemyWarships <= 0 || friendlyWarships >= Math.max(1, enemyWarships * 2);

export function chooseBoatPosition(
  context: BoatPositionContext,
): BoatPositionDecision {
  const hasBattleSuperiority = hasTwoToOneNavalSuperiority(
    context.nearbyFriendlyWarships,
    context.nearbyEnemyWarships,
  );

  if (!hasBattleSuperiority && context.nearbyEnemyWarships > 0) {
    return context.insideFriendlyPort === true ? "hold-in-port" : "retreat";
  }

  if (
    context.distanceToUsefulCoastalTarget !== null &&
    context.carryingTroops > 0 &&
    context.distanceToUsefulCoastalTarget <= 140
  ) {
    return "approach-target";
  }

  return context.insideFriendlyPort === true
    ? "hold-in-port"
    : "hold-near-coast";
}

export function planCoastalRaid(context: CoastalRaidContext): CoastalRaidPlan {
  if (context.activeBoatRaids >= context.maxBoatRaids) {
    return { action: "hold", reason: "boat raid limit reached" };
  }

  const spendableTroops = Math.max(
    0,
    context.availableFleetTroops - context.reserveFleetTroops,
  );
  if (spendableTroops <= 0) {
    return { action: "hold", reason: "fleet reserve must be preserved" };
  }

  const candidates = context.targets
    .filter((target) => target.coastalBuildingValue > 0)
    .filter(
      (target) =>
        target.friendlyPortProtection === true ||
        hasTwoToOneNavalSuperiority(
          target.nearbyFriendlyWarships,
          target.nearbyEnemyWarships,
        ),
    )
    .map((target) => {
      const requiredTroops = Math.ceil(
        Math.max(
          500,
          Math.round(
            target.coastalTroops * target.landingDefenseMultiplier * 1.12 * 1e6,
          ) / 1e6,
        ),
      );
      const distancePenalty = target.distanceFromFriendlyCoast / 12;
      const warPenalty = target.wouldOpenNationWar ? 45 : 0;
      const portSafetyBonus = target.friendlyPortProtection === true ? 8 : 0;
      const navalSuperiorityBonus =
        target.nearbyEnemyWarships > 0
          ? Math.min(
              10,
              target.nearbyFriendlyWarships /
                Math.max(1, target.nearbyEnemyWarships),
            )
          : 4;
      const score =
        target.coastalBuildingValue * 20 -
        requiredTroops / 2_000 -
        distancePenalty -
        warPenalty +
        portSafetyBonus +
        navalSuperiorityBonus;
      return { target, requiredTroops, score };
    })
    .filter((plan) => plan.requiredTroops <= spendableTroops)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (best === undefined || best.score <= 0) {
    return {
      action: "hold",
      reason: "no profitable raid has safe two-to-one naval support",
    };
  }

  return {
    action: "raid",
    targetID: best.target.id,
    troops: best.requiredTroops,
    reason:
      best.target.friendlyPortProtection === true
        ? "raid from friendly port protection with limited troop exposure"
        : "raid only with at least two-to-one warship superiority",
  };
}
