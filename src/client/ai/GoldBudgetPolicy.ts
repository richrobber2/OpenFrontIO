export type GoldSpendCategory =
  | "emergency-defense"
  | "economy"
  | "navy"
  | "strategic-weapons"
  | "infrastructure"
  | "diplomacy"
  | "hold";

export interface GoldBudgetContext {
  gold: number;
  incomePerMinute: number;
  emergencyGoldFloor: number;
  activeNationWars: number;
  incomingStrikeRisk: number;
  borderPressure: number;
  uncoveredCriticalStructures: number;
  usefulPortSites: number;
  existingPorts: number;
  existingCities: number;
  existingDefensePosts: number;
  existingSams: number;
  existingSilos: number;
  economyReturnScore: number;
  navalNeedScore: number;
  strategicWeaponValue: number;
  infrastructureNeedScore: number;
  allyAidUrgency: number;
  recentLowValuePurchases: number;
  coastalEconomicTargets?: number;
  enemyWarshipsNearTargets?: number;
  enemyMissileSilos?: number;
  productiveStackSites?: number;
}

export interface GoldBudgetDecision {
  category: GoldSpendCategory;
  spendCap: number;
  reserveFloor: number;
  minimumQueuedPurchases: number;
  allowProductiveStacking: boolean;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function chooseGoldBudget(
  context: GoldBudgetContext,
): GoldBudgetDecision {
  const risk = clamp(
    Math.max(
      context.incomingStrikeRisk,
      context.borderPressure,
      context.activeNationWars / 3,
    ),
    0,
    1,
  );
  const dynamicReserve = Math.max(
    context.emergencyGoldFloor,
    context.incomePerMinute * (1.5 + risk * 2.5),
  );
  const spendable = Math.max(0, context.gold - dynamicReserve);
  const reserveMultiple = context.gold / Math.max(1, dynamicReserve);
  const largeSurplus = reserveMultiple >= 3;
  const extremeSurplus = reserveMultiple >= 6;
  const runawaySurplus = reserveMultiple >= 20 || context.gold >= 100_000_000;

  const hold = (reason: string): GoldBudgetDecision => ({
    category: "hold",
    spendCap: 0,
    reserveFloor: dynamicReserve,
    minimumQueuedPurchases: 0,
    allowProductiveStacking: false,
    reason,
  });

  if (spendable <= 0) return hold("treasury is at the strategic reserve floor");

  if (
    context.incomingStrikeRisk >= 0.55 &&
    context.uncoveredCriticalStructures > 0
  ) {
    return {
      category: "emergency-defense",
      spendCap: Math.min(spendable, Math.max(context.gold * 0.45, spendable * 0.5)),
      reserveFloor: dynamicReserve,
      minimumQueuedPurchases: runawaySurplus ? 8 : extremeSurplus ? 4 : 1,
      allowProductiveStacking: runawaySurplus,
      reason: "protect critical structures before discretionary spending",
    };
  }

  if (context.borderPressure >= 0.65 && context.existingDefensePosts < 4) {
    return {
      category: "emergency-defense",
      spendCap: Math.min(spendable, Math.max(context.gold * 0.35, spendable * 0.4)),
      reserveFloor: dynamicReserve,
      minimumQueuedPurchases: runawaySurplus ? 6 : 1,
      allowProductiveStacking: runawaySurplus,
      reason: "fund layered defenses on the pressured front",
    };
  }

  const antiWastePenalty = Math.min(12, context.recentLowValuePurchases * 3);
  const coastalTargets = Math.max(0, context.coastalEconomicTargets ?? 0);
  const navalOpposition = Math.max(0, context.enemyWarshipsNearTargets ?? 0);
  const enemySilos = Math.max(0, context.enemyMissileSilos ?? 0);
  const productiveStackSites = Math.max(0, context.productiveStackSites ?? 0);
  const economyScore = context.economyReturnScore * 1.3;
  const navyScore =
    context.navalNeedScore +
    Math.min(6, context.usefulPortSites * 1.5) +
    Math.min(12, coastalTargets * 2.5) -
    Math.min(8, navalOpposition * 2) -
    Math.max(0, context.existingPorts - Math.max(3, context.usefulPortSites)) * 1.5;
  const weaponScore =
    context.strategicWeaponValue + enemySilos * 3 - Math.max(0, context.existingSilos - 1) * 4;
  const infrastructureScore =
    context.infrastructureNeedScore +
    Math.min(8, productiveStackSites * 1.5) -
    Math.max(0, context.existingCities - 6) -
    antiWastePenalty;
  const diplomacyScore = context.allyAidUrgency - risk * 8;

  const ranked: Array<[GoldSpendCategory, number]> = [
    ["economy", economyScore],
    ["navy", navyScore],
    ["strategic-weapons", weaponScore],
    ["infrastructure", infrastructureScore],
    ["diplomacy", diplomacyScore],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  let [category, score] = ranked[0];

  const canSnowballAtSea =
    coastalTargets > 0 &&
    (context.existingPorts > 0 || context.usefulPortSites > 0) &&
    navalOpposition <= Math.max(1, context.existingPorts * 2);

  let mediocreRunaway = false;
  if (runawaySurplus) {
    if (canSnowballAtSea) category = "navy";
    else if (productiveStackSites > 0) category = "infrastructure";
    else if (score < 3) {
      category =
        context.economyReturnScore >= context.infrastructureNeedScore
          ? "economy"
          : "infrastructure";
      mediocreRunaway = true;
    } else if (economyScore >= score) category = "economy";
    score = Math.max(score, 10);
  } else if (extremeSurplus && canSnowballAtSea) {
    category = "navy";
    score = Math.max(score, navyScore, 8);
  } else if (extremeSurplus && score < 3) {
    category =
      context.economyReturnScore >= context.infrastructureNeedScore
        ? "economy"
        : "infrastructure";
  }

  if (!largeSurplus && score < 6) {
    return hold("no available purchase has enough strategic return");
  }

  const capRatio =
    risk >= 0.65
      ? 0.25
      : runawaySurplus
        ? 0.94
        : extremeSurplus
          ? canSnowballAtSea
            ? 0.85
            : 0.8
          : largeSurplus
            ? 0.6
            : 0.35;
  const minimumDeployment = runawaySurplus
    ? spendable * 0.85
    : extremeSurplus
      ? spendable * (canSnowballAtSea ? 0.7 : 0.6)
      : largeSurplus
        ? spendable * 0.35
        : 0;
  const spendCap = Math.min(
    spendable,
    Math.max(context.gold * capRatio, minimumDeployment),
  );

  return {
    category,
    spendCap,
    reserveFloor: dynamicReserve,
    minimumQueuedPurchases: runawaySurplus
      ? Math.min(32, Math.max(10, productiveStackSites + context.usefulPortSites * 2))
      : extremeSurplus
        ? 6
        : largeSurplus
          ? 3
          : 1,
    allowProductiveStacking: runawaySurplus || (extremeSurplus && productiveStackSites > 0),
    reason: runawaySurplus
      ? mediocreRunaway
        ? `extreme surplus forces a useful sink in ${category}`
        : `mass-deploy runaway treasury into ${category}`
      : extremeSurplus && canSnowballAtSea
        ? "convert extreme surplus into shipyards and warships for coastal economic theft"
        : extremeSurplus
          ? `deploy extreme surplus into ${category}`
          : largeSurplus
            ? `reduce excess treasury through ${category}`
            : `allocate the next purchase to ${category}`,
  };
}
