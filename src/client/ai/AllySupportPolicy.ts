export interface AllySupportContext {
  ownGold: number;
  ownTroops: number;
  ownMaxTroops?: number;
  ownCities?: number;
  ownTroopRegenPerMinute?: number;
  ownEmergencyGoldFloor: number;
  ownReserveTroops: number;
  ownActiveWars: number;
  ownImmediateSpendingNeed: number;
  ownBorderThreat?: number;
  ticksSinceLastAid: number;
  allianceAgeTicks?: number;
  allyTrust: number;
  allyBetrayalRisk: number;
  allyReciprocity?: number;
  allySharesBorder?: boolean;
  cumulativeTroopsSentToAlly?: number;
  cumulativeGoldSentToAlly?: number;
  allyGold: number;
  allyTroops: number;
  allyIncomingTroops: number;
  allyMinimumSurvivalTroops: number;
  allyPlannedBuildCost: number | null;
  allyPowerRatioToSelf: number;
}

export interface AllySupportDecision {
  action: "hold" | "send-gold" | "send-troops";
  amount: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const ALLY_AID_COOLDOWN_TICKS = 300;
const MIN_ALLIANCE_AGE_FOR_MATERIAL_AID = 600;

/**
 * Uses disposable surplus to keep a proven ally alive without financing a future
 * attacker. Repeated aid requires reciprocity, and cumulative exposure increases
 * the reserve kept at home, especially when the ally can attack across a shared
 * border immediately after receiving support.
 */
export function chooseAllySupport(
  context: AllySupportContext,
): AllySupportDecision {
  const trust = clamp(context.allyTrust, 0, 1);
  const reportedBetrayalRisk = clamp(context.allyBetrayalRisk, 0, 1);
  const reciprocity = clamp(context.allyReciprocity ?? 0.5, 0, 1);
  const borderThreat = clamp(context.ownBorderThreat ?? 0, 0, 1);
  const allianceAgeTicks = Math.max(0, context.allianceAgeTicks ?? Number.MAX_SAFE_INTEGER);
  const sharesBorder = context.allySharesBorder ?? false;
  const troopsAlreadySent = Math.max(0, context.cumulativeTroopsSentToAlly ?? 0);
  const goldAlreadySent = Math.max(0, context.cumulativeGoldSentToAlly ?? 0);

  const ownMaxTroops = Math.max(context.ownTroops, context.ownMaxTroops ?? 0);
  const troopExposureRatio = troopsAlreadySent / Math.max(1, ownMaxTroops);
  const goldExposureRatio = goldAlreadySent / Math.max(1, context.ownGold + goldAlreadySent);
  const youthPenalty =
    allianceAgeTicks < MIN_ALLIANCE_AGE_FOR_MATERIAL_AID
      ? 1 - allianceAgeTicks / MIN_ALLIANCE_AGE_FOR_MATERIAL_AID
      : 0;
  const effectiveBetrayalRisk = clamp(
    reportedBetrayalRisk +
      (1 - reciprocity) * 0.24 +
      (sharesBorder ? 0.12 : 0) +
      youthPenalty * 0.18 +
      troopExposureRatio * 0.3 +
      goldExposureRatio * 0.2,
    0,
    1,
  );

  if (
    context.ownActiveWars > 0 ||
    context.ownImmediateSpendingNeed > 0.35 ||
    borderThreat > 0.45
  ) {
    return {
      action: "hold",
      amount: 0,
      reason: "own strategic needs and border security take priority over ally aid",
    };
  }

  if (context.ticksSinceLastAid < ALLY_AID_COOLDOWN_TICKS) {
    return { action: "hold", amount: 0, reason: "ally aid cooldown is active" };
  }

  if (allianceAgeTicks < MIN_ALLIANCE_AGE_FOR_MATERIAL_AID && trust < 0.92) {
    return {
      action: "hold",
      amount: 0,
      reason: "the alliance is too new to justify material exposure",
    };
  }

  if (trust < 0.75 || effectiveBetrayalRisk > 0.36) {
    return {
      action: "hold",
      amount: 0,
      reason: "betrayal exposure is too high for additional material support",
    };
  }

  if (reciprocity < 0.35 && (troopsAlreadySent > 0 || goldAlreadySent > 0)) {
    return {
      action: "hold",
      amount: 0,
      reason: "the ally has not reciprocated earlier support",
    };
  }

  if (context.allyPowerRatioToSelf >= 0.82) {
    return {
      action: "hold",
      amount: 0,
      reason: "the ally is already too strong relative to us",
    };
  }

  if (troopExposureRatio >= 0.14 || goldExposureRatio >= 0.18) {
    return {
      action: "hold",
      amount: 0,
      reason: "cumulative aid exposure has reached the safe limit",
    };
  }

  const cities = Math.max(0, context.ownCities ?? 0);
  const regen = Math.max(0, context.ownTroopRegenPerMinute ?? 0);
  const capacityUsage =
    ownMaxTroops > 0 ? clamp(context.ownTroops / ownMaxTroops, 0, 1) : 0;
  const cityCapacityBonus = clamp(cities / 8, 0, 1);
  const regenBonus = clamp(regen / Math.max(1, ownMaxTroops * 0.08), 0, 1);
  const capacityReserveRatio =
    0.72 -
    cityCapacityBonus * 0.04 -
    regenBonus * 0.03 +
    effectiveBetrayalRisk * 0.16 +
    borderThreat * 0.12 +
    (sharesBorder ? 0.06 : 0) +
    troopExposureRatio * 0.25;
  const capacityReserveTroops = Math.floor(
    ownMaxTroops * clamp(capacityReserveRatio, 0.66, 0.88),
  );
  const effectiveReserveTroops = Math.max(
    context.ownReserveTroops,
    capacityReserveTroops,
  );
  const spendableTroops = Math.max(
    0,
    context.ownTroops - effectiveReserveTroops,
  );
  const projectedAllyTroops = context.allyTroops - context.allyIncomingTroops;
  const troopSurvivalGap = Math.max(
    0,
    context.allyMinimumSurvivalTroops - projectedAllyTroops,
  );

  if (troopSurvivalGap > 0 && spendableTroops > 0) {
    const trustMultiplier = clamp((trust - 0.72) / 0.28, 0, 1);
    const highCapacity =
      capacityUsage >= 0.88 &&
      (cities >= 5 || regenBonus >= 0.65) &&
      effectiveBetrayalRisk <= 0.2;
    const transferRatio = highCapacity
      ? 0.045 + trustMultiplier * 0.025 - effectiveBetrayalRisk * 0.04
      : 0.02 + trustMultiplier * 0.015 - effectiveBetrayalRisk * 0.025;
    const remainingExposureRatio = Math.max(0, 0.14 - troopExposureRatio);
    const exposureCap = Math.floor(ownMaxTroops * remainingExposureRatio);
    const balanceCap = Math.max(
      0,
      Math.floor(ownMaxTroops * clamp(transferRatio, 0.01, 0.07)),
    );
    const survivalBridge = Math.max(
      1,
      Math.ceil(troopSurvivalGap * (highCapacity ? 0.5 : 0.28)),
    );
    const amount = Math.min(
      survivalBridge,
      spendableTroops,
      balanceCap,
      exposureCap,
    );
    if (amount > 0) {
      return {
        action: "send-troops",
        amount,
        reason: highCapacity
          ? "send a guarded city-backed survival bridge while preserving betrayal reserves"
          : "send only a small emergency bridge and retain the army at home",
      };
    }
  }

  const spendableGold = Math.max(
    0,
    context.ownGold - context.ownEmergencyGoldFloor,
  );
  const buildGap =
    context.allyPlannedBuildCost === null
      ? 0
      : Math.max(0, context.allyPlannedBuildCost - context.allyGold);

  if (buildGap > 0 && spendableGold > 0) {
    const remainingGoldExposure = Math.max(
      0,
      Math.floor((context.ownGold + goldAlreadySent) * 0.18 - goldAlreadySent),
    );
    const balanceCap = Math.max(
      0,
      Math.floor(context.ownGold * (0.045 - effectiveBetrayalRisk * 0.025)),
    );
    const amount = Math.min(
      buildGap,
      spendableGold,
      balanceCap,
      remainingGoldExposure,
    );
    if (amount > 0) {
      return {
        action: "send-gold",
        amount,
        reason: "fund only a small immediate shortfall within the ally exposure budget",
      };
    }
  }

  return {
    action: "hold",
    amount: 0,
    reason: "the ally is stable or further aid creates unacceptable betrayal exposure",
  };
}
