export interface CoalitionHelperOption {
  allyId: string;
  reliability: number;
  reserveRatio: number;
  canReach: boolean;
  treatyBlocked: boolean;
}

export interface CoalitionTargetOption {
  targetId: string;
  basePriority: number;
  ownCanReach: boolean;
  enemyActiveWars: number;
  helpers: readonly CoalitionHelperOption[];
}

export interface CoalitionTargetDecision {
  targetId: string;
  score: number;
  offensiveCostMultiplier: number;
  availableHelperIds: string[];
  treatyBlockedHelperIds: string[];
  reason: string;
}

export interface CoalitionGrowthSupportContext {
  ownTroops: number;
  ownMaxTroops: number;
  reserveFloor: number;
  activeNationWars: number;
  incomingFronts: number;
  allyTroops: number;
  allyMaxTroops: number;
  allyReliability: number;
  allyIsNation: boolean;
  canDonate: boolean;
  allyHasGrowthRoute: boolean;
  troopGrowthAt: (troops: number) => number;
  allyCommittedTroops?: number;
  sharedEnemyTroops?: number;
  sharedEnemyMaxTroops?: number;
  sharedEnemyIsNation?: boolean;
  allyCanPressureSharedEnemy?: boolean;
  enemyGrowthAt?: (troops: number) => number;
}

export interface CoalitionGrowthSupportDecision {
  donate: boolean;
  amount: number;
  purpose: "none" | "growth" | "pressure";
  ownReserveAfter: number;
  growthRateBefore: number;
  growthRateAfter: number;
  growthRateGainRatio: number;
  enemyGrowthRateBefore: number;
  enemyGrowthRateAfter: number;
  enemyGrowthSuppressionRatio: number;
  projectedEnemyReserveAfter: number;
  reason: string;
}

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

/**
 * Select one coalition target instead of asking every ally to attack a
 * different enemy. Helpers only count when they can reach the target and are
 * not prevented from attacking it by their own alliance or team.
 */
export function selectCoalitionTarget(
  options: readonly CoalitionTargetOption[],
): CoalitionTargetDecision | undefined {
  return options
    .filter((option) => option.ownCanReach)
    .map((option) => {
      const availableHelpers = option.helpers.filter(
        (helper) =>
          helper.canReach &&
          !helper.treatyBlocked &&
          helper.reliability >= 0.45 &&
          helper.reserveRatio >= 0.5,
      );
      const treatyBlockedHelpers = option.helpers.filter(
        (helper) => helper.canReach && helper.treatyBlocked,
      );
      const helperValue = availableHelpers.reduce(
        (sum, helper) =>
          sum +
          helper.reliability * 1.5 +
          clamp((helper.reserveRatio - 0.5) / 0.5) * 0.75,
        0,
      );
      const score =
        option.basePriority +
        helperValue +
        Math.min(3, Math.max(0, option.enemyActiveWars)) * 0.3 -
        treatyBlockedHelpers.length * 0.15;
      const offensiveCostMultiplier = clamp(
        1 - Math.min(0.32, helperValue * 0.18),
        0.68,
        1,
      );
      return {
        targetId: option.targetId,
        score,
        offensiveCostMultiplier,
        basePriority: option.basePriority,
        availableHelperIds: availableHelpers.map((helper) => helper.allyId),
        treatyBlockedHelperIds: treatyBlockedHelpers.map(
          (helper) => helper.allyId,
        ),
        reason:
          availableHelpers.length > 0
            ? `${availableHelpers.length} ally or allies can legally reach this target`
            : treatyBlockedHelpers.length > 0
              ? "reachable allies are treaty-blocked from helping on this target"
              : "this is currently a solo reachable target",
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.availableHelperIds.length - a.availableHelperIds.length ||
        b.basePriority - a.basePriority,
    )[0];
}

/**
 * Move only a safe part of an overfull home reserve into a reliable allied
 * nation. The donation may fund legal territorial growth or sustain an
 * existing attack that mathematically pushes a shared enemy below its peak
 * regeneration band. It never treats a nearly dead ally as a source of troops.
 */
export function planCoalitionGrowthSupport(
  context: CoalitionGrowthSupportContext,
): CoalitionGrowthSupportDecision {
  const ownMaxTroops = Math.max(1, context.ownMaxTroops);
  const allyMaxTroops = Math.max(1, context.allyMaxTroops);
  const ownTroops = Math.max(0, context.ownTroops);
  const allyTroops = Math.max(0, context.allyTroops);
  const growthRateBefore = Math.max(0, context.troopGrowthAt(ownTroops));
  const reject = (reason: string): CoalitionGrowthSupportDecision => ({
    donate: false,
    amount: 0,
    purpose: "none",
    ownReserveAfter: ownTroops / ownMaxTroops,
    growthRateBefore,
    growthRateAfter: growthRateBefore,
    growthRateGainRatio: 1,
    enemyGrowthRateBefore: 0,
    enemyGrowthRateAfter: 0,
    enemyGrowthSuppressionRatio: 0,
    projectedEnemyReserveAfter: 1,
    reason,
  });

  if (!context.allyIsNation || !context.canDonate) {
    return reject("the recipient is not a legal allied nation donation target");
  }
  if (context.activeNationWars > 0 || context.incomingFronts > 0) {
    return reject(
      "an active home front requires keeping the surplus available",
    );
  }

  const ownReserveRatio = ownTroops / ownMaxTroops;
  const allyReserveRatio = allyTroops / allyMaxTroops;
  if (ownReserveRatio < 0.82 || allyReserveRatio >= 0.9) {
    return reject(
      "the donor lacks an overfull reserve or the ally lacks useful troop headroom",
    );
  }

  const safeReserveRatio = Math.max(0.68, clamp(context.reserveFloor) + 0.16);
  const safeReserveTroops = ownMaxTroops * safeReserveRatio;
  const availableSurplus = Math.max(0, ownTroops - safeReserveTroops);
  const allyHeadroom = Math.max(0, allyMaxTroops - allyTroops);

  const pressureEligible =
    context.sharedEnemyIsNation === true &&
    context.allyCanPressureSharedEnemy === true &&
    (context.allyCommittedTroops ?? 0) > 0 &&
    (context.sharedEnemyTroops ?? 0) > 0 &&
    (context.sharedEnemyMaxTroops ?? 0) > 0 &&
    context.enemyGrowthAt !== undefined &&
    context.allyReliability >= 0.5;
  if (pressureEligible) {
    const maximumPressureAmount = Math.floor(
      Math.min(ownTroops * 0.12, availableSurplus * 0.45, allyHeadroom * 0.2),
    );
    const minimumUsefulAmount = Math.max(
      ownMaxTroops * 0.008,
      maximumPressureAmount * 0.25,
    );
    const enemyTroops = Math.max(0, context.sharedEnemyTroops ?? 0);
    const enemyMaxTroops = Math.max(1, context.sharedEnemyMaxTroops ?? 1);
    const alliedPressure = Math.max(0, context.allyCommittedTroops ?? 0);
    const combatConversion = 0.38;
    const baselineEnemyAfter = Math.max(
      0,
      enemyTroops - alliedPressure * combatConversion,
    );
    const enemyGrowthRateBefore = Math.max(
      0,
      context.enemyGrowthAt!(baselineEnemyAfter),
    );
    const candidates = [0.25, 0.5, 0.75, 1]
      .map((fraction) => Math.floor(maximumPressureAmount * fraction))
      .filter((amount) => amount >= minimumUsefulAmount)
      .map((amount) => {
        const ownTroopsAfter = ownTroops - amount;
        const growthRateAfter = Math.max(
          0,
          context.troopGrowthAt(ownTroopsAfter),
        );
        const projectedEnemyTroops = Math.max(
          0,
          baselineEnemyAfter - amount * combatConversion,
        );
        const enemyGrowthRateAfter = Math.max(
          0,
          context.enemyGrowthAt!(projectedEnemyTroops),
        );
        const enemyGrowthSuppressionRatio =
          enemyGrowthRateBefore <= 0
            ? 0
            : (enemyGrowthRateBefore - enemyGrowthRateAfter) /
              enemyGrowthRateBefore;
        return {
          amount,
          ownTroopsAfter,
          growthRateAfter,
          growthRateGainRatio:
            growthRateBefore <= 0
              ? growthRateAfter > 0
                ? 10
                : 1
              : growthRateAfter / growthRateBefore,
          projectedEnemyTroops,
          projectedEnemyReserveAfter: projectedEnemyTroops / enemyMaxTroops,
          enemyGrowthRateBefore,
          enemyGrowthRateAfter,
          enemyGrowthSuppressionRatio,
        };
      })
      .filter(
        (candidate) =>
          candidate.ownTroopsAfter >= safeReserveTroops &&
          candidate.growthRateGainRatio >= 1.01 &&
          (candidate.enemyGrowthSuppressionRatio >= 0.05 ||
            candidate.projectedEnemyReserveAfter <= 0.16),
      )
      .sort(
        (a, b) =>
          b.enemyGrowthSuppressionRatio - a.enemyGrowthSuppressionRatio ||
          a.amount - b.amount,
      );
    const selected = candidates[0];
    if (selected !== undefined) {
      return {
        donate: true,
        amount: selected.amount,
        purpose: "pressure",
        ownReserveAfter: selected.ownTroopsAfter / ownMaxTroops,
        growthRateBefore,
        growthRateAfter: selected.growthRateAfter,
        growthRateGainRatio: selected.growthRateGainRatio,
        enemyGrowthRateBefore: selected.enemyGrowthRateBefore,
        enemyGrowthRateAfter: selected.enemyGrowthRateAfter,
        enemyGrowthSuppressionRatio: selected.enemyGrowthSuppressionRatio,
        projectedEnemyReserveAfter: selected.projectedEnemyReserveAfter,
        reason:
          "the ally is already pinning a shared nation and added troops reduce its projected regeneration",
      };
    }
  }

  if (!context.allyHasGrowthRoute) {
    return reject(
      "the ally cannot turn a troop donation into territorial growth or useful shared pressure",
    );
  }
  if (context.allyReliability < 0.58) {
    return reject("the ally is not reliable enough for growth investment");
  }
  if (allyReserveRatio >= 0.82) {
    return reject("the ally lacks useful troop headroom for growth");
  }

  const amount = Math.floor(
    Math.min(ownTroops * 0.16, availableSurplus * 0.5, allyHeadroom * 0.25),
  );
  if (amount < ownMaxTroops * 0.01) {
    return reject("the safe growth surplus is too small to change the front");
  }

  const ownTroopsAfter = ownTroops - amount;
  const growthRateAfter = Math.max(0, context.troopGrowthAt(ownTroopsAfter));
  const growthRateGainRatio =
    growthRateBefore <= 0
      ? growthRateAfter > 0
        ? 10
        : 1
      : growthRateAfter / growthRateBefore;
  if (growthRateGainRatio < 1.02) {
    return reject(
      "the proposed donation would not improve the donor's regeneration rate",
    );
  }

  return {
    donate: true,
    amount,
    purpose: "growth",
    ownReserveAfter: ownTroopsAfter / ownMaxTroops,
    growthRateBefore,
    growthRateAfter,
    growthRateGainRatio,
    enemyGrowthRateBefore: 0,
    enemyGrowthRateAfter: 0,
    enemyGrowthSuppressionRatio: 0,
    projectedEnemyReserveAfter: 1,
    reason:
      "a reliable nation has a legal growth route while the donation increases home regeneration",
  };
}
