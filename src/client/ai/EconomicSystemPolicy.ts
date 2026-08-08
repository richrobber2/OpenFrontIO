import {
  capacityEscapeCityBudgetRust,
  planEconomicSystemsRust,
  preloadRustEconomyAi,
  shouldFundFirstPressureFactoryRust,
} from "../rust/OpenFrontWasmEconomyAi";

void preloadRustEconomyAi();

export type EconomicSystemAction =
  | "bank"
  | "protect-assets"
  | "stack-capacity"
  | "activate-rail"
  | "extend-trade";

export type EconomicSystemScores = Record<EconomicSystemAction, number>;

export interface EconomicSystemContext {
  gold: number;
  incomePerMinute: number;
  reserveRatio: number;
  incomingTroopRatio: number;
  hostileFronts: number;
  activeNationWars: number;
  hasNeutralLand: boolean;
  trapped: boolean;

  cities: number;
  desiredCities: number;
  stackedCities: number;
  factories: number;
  productiveFactoryStops: number;
  isolatedFactories: number;
  ports: number;
  factoryConnectedPorts?: number;
  unconnectedPorts?: number;
  tradePartners: number;
  embargoedPartners: number;
  railStops: number;
  connectedRailStops: number;
  defensePosts: number;
  strategicStructures: number;
  exposedEconomicStructures: number;

  cityCost: number;
  factoryCost: number;
  portCost: number;
  defensePostCost: number;
}

export interface EconomicSystemPlan {
  action: EconomicSystemAction;
  score: number;
  scores: EconomicSystemScores;
  risk: number;
  goldReserveFloor: number;
  spendableGold: number;
  economyReturnScore: number;
  infrastructureNeedScore: number;
  tradeCoverageTargetRatio: number;
  capitalDeploymentPressure: number;
  reason: string;
}

export function capacityEscapeCityBudget({
  gold,
  protectedSpendableGold,
  cityCost,
  cities,
  desiredCities,
  requiredTroops,
  maxTroops,
  incomingFronts,
  hostileFronts = 0,
  activeNationWars = 0,
  reserveRatio = 0,
}: {
  gold: number;
  protectedSpendableGold: number;
  cityCost: number;
  cities: number;
  desiredCities: number;
  requiredTroops: number;
  maxTroops: number;
  incomingFronts: number;
  hostileFronts?: number;
  activeNationWars?: number;
  reserveRatio?: number;
}): { spendableGold: number; bypassBank: boolean } {
  const rust = capacityEscapeCityBudgetRust({
    gold,
    protectedSpendableGold,
    cityCost,
    cities,
    desiredCities,
    requiredTroops,
    maxTroops,
    incomingFronts,
    hostileFronts,
    activeNationWars,
    reserveRatio,
  });
  if (rust !== null) return rust;

  const capacityBlocked = requiredTroops > maxTroops * 1.02;
  const affordableFromTreasury = cityCost > 0 && gold >= cityCost;
  const needsCity = cities < desiredCities;
  const multiFrontCapacityRisk =
    hostileFronts + activeNationWars >= 4 && reserveRatio >= 0.68;
  const bypassBank =
    (capacityBlocked || multiFrontCapacityRisk) &&
    affordableFromTreasury &&
    needsCity &&
    incomingFronts === 0;
  return {
    spendableGold: bypassBank ? gold : protectedSpendableGold,
    bypassBank,
  };
}

export function shouldFundFirstPressureFactory({
  factories,
  cities,
  ownedTiles,
  reserveRatio,
  incomingFronts,
  hostileFronts,
  activeNationWars,
  noGrowthTicks,
  unconnectedPorts,
}: {
  factories: number;
  cities: number;
  ownedTiles: number;
  reserveRatio: number;
  incomingFronts: number;
  hostileFronts: number;
  activeNationWars: number;
  noGrowthTicks: number;
  unconnectedPorts: number;
}): boolean {
  const rust = shouldFundFirstPressureFactoryRust({
    factories,
    cities,
    ownedTiles,
    reserveRatio,
    incomingFronts,
    hostileFronts,
    activeNationWars,
    noGrowthTicks,
    unconnectedPorts,
  });
  if (rust !== null) return rust;

  const earlyGrowthUnlock =
    ownedTiles >= 5_000 && (noGrowthTicks >= 300 || unconnectedPorts > 0);
  const territoryReady = ownedTiles >= 8_000 || earlyGrowthUnlock;
  return (
    factories === 0 &&
    cities >= 1 &&
    territoryReady &&
    reserveRatio >= 0.58 &&
    incomingFronts === 0 &&
    (noGrowthTicks >= 180 ||
      hostileFronts + activeNationWars >= 2 ||
      unconnectedPorts > 0)
  );
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const positiveCosts = (context: EconomicSystemContext): number[] =>
  [
    context.cityCost,
    context.factoryCost,
    context.portCost,
    context.defensePostCost,
  ].filter((cost) => Number.isFinite(cost) && cost > 0);

function reasonForAction(
  action: EconomicSystemAction,
  context: EconomicSystemContext,
  plan: Pick<
    EconomicSystemPlan,
    "goldReserveFloor" | "risk" | "tradeCoverageTargetRatio"
  >,
): string {
  const factoryConnectedPorts = Math.max(0, context.factoryConnectedPorts ?? 0);
  const unconnectedPorts = Math.max(
    0,
    context.unconnectedPorts ??
      Math.max(0, context.ports - factoryConnectedPorts),
  );
  const cityGap = Math.max(0, context.desiredCities - context.cities);
  const unstackedRatio =
    context.cities <= 1
      ? 0
      : clamp((context.cities - context.stackedCities) / context.cities, 0, 1);
  const reasonByAction: Record<EconomicSystemAction, string> = {
    bank: `preserve ${Math.round(plan.goldReserveFloor).toLocaleString()} gold against ${Math.round(plan.risk * 100)}% strategic risk`,
    "protect-assets": `cover ${context.exposedEconomicStructures}/${context.strategicStructures} exposed economic structures before compounding`,
    "stack-capacity": `close a ${cityGap}-city capacity gap and reduce ${Math.round(unstackedRatio * 100)}% scattered-city exposure`,
    "activate-rail": `activate ${context.connectedRailStops}/${context.railStops} rail stops, connect ${unconnectedPorts} isolated shipyards, and repair ${context.isolatedFactories} isolated factories`,
    "extend-trade": `cover ${Math.round(plan.tradeCoverageTargetRatio * 100)}% of ${context.tradePartners} usable trade partners through ${factoryConnectedPorts}/${context.ports} factory-connected shipyards while discounting ${context.embargoedPartners} embargoed relationships`,
  };
  return reasonByAction[action];
}

/**
 * Connect economic spending to the systems that make it useful or fragile:
 * troop capacity, regeneration, rail activation, trade access, embargoes,
 * defensive coverage, live income, and the actual replacement cost of assets.
 * Deep safe surplus now applies bounded pressure to deploy capital into
 * compounding systems instead of accumulating indefinitely.
 */
export function planEconomicSystems(
  context: EconomicSystemContext,
): EconomicSystemPlan {
  const rust = planEconomicSystemsRust(context);
  if (rust !== null) {
    return {
      ...rust,
      reason: reasonForAction(rust.action, context, rust),
    };
  }

  const risk = clamp(
    Math.max(
      context.incomingTroopRatio,
      context.activeNationWars / 3,
      context.hostileFronts / 5,
    ),
    0,
    1,
  );
  const costs = positiveCosts(context);
  const minimumBuildCost = costs.length > 0 ? Math.min(...costs) : 0;
  const averageEconomicCost =
    [context.cityCost, context.factoryCost, context.portCost]
      .filter((cost) => Number.isFinite(cost) && cost > 0)
      .reduce((sum, cost, _, values) => sum + cost / values.length, 0) ||
    minimumBuildCost;
  const replacementReserve =
    Math.max(0, context.exposedEconomicStructures) * averageEconomicCost * 0.35;
  const incomeReserve =
    Math.max(0, context.incomePerMinute) * (0.75 + risk * 1.75);
  const goldReserveFloor = Math.max(
    minimumBuildCost,
    incomeReserve,
    replacementReserve,
  );
  const spendableGold = Math.max(0, context.gold - goldReserveFloor);

  const structureCount = Math.max(1, context.strategicStructures);
  const exposureRatio = clamp(
    context.exposedEconomicStructures / structureCount,
    0,
    1,
  );
  const cityGap = Math.max(0, context.desiredCities - context.cities);
  const unstackedRatio =
    context.cities <= 1
      ? 0
      : clamp((context.cities - context.stackedCities) / context.cities, 0, 1);
  const railCoverage =
    context.railStops <= 0
      ? 0
      : clamp(context.connectedRailStops / context.railStops, 0, 1);
  const productiveStopsPerFactory =
    context.factories <= 0
      ? 0
      : context.productiveFactoryStops / context.factories;
  const knownTradeRelationships =
    Math.max(0, context.tradePartners) + Math.max(0, context.embargoedPartners);
  const embargoRatio =
    knownTradeRelationships <= 0
      ? 0
      : clamp(context.embargoedPartners / knownTradeRelationships, 0, 1);
  const tradeCoverageTargetRatio = clamp(
    0.05 +
      (1 - embargoRatio) * 0.06 +
      clamp(context.reserveRatio, 0, 1) * 0.05 +
      (1 - risk) * 0.04,
    0.05,
    0.2,
  );
  const desiredPorts =
    context.tradePartners <= 0
      ? 0
      : Math.max(
          1,
          Math.ceil(context.tradePartners * tradeCoverageTargetRatio),
        );
  const portGap = Math.max(0, desiredPorts - context.ports);
  const factoryConnectedPorts = Math.max(0, context.factoryConnectedPorts ?? 0);
  const unconnectedPorts = Math.max(
    0,
    context.unconnectedPorts ??
      Math.max(0, context.ports - factoryConnectedPorts),
  );
  const railGap = 1 - railCoverage;
  const unconnectedPortRatio =
    context.ports <= 0 ? 0 : clamp(unconnectedPorts / context.ports, 0, 1);
  const isolatedFactoryRatio =
    context.factories <= 0
      ? 0
      : clamp(context.isolatedFactories / context.factories, 0, 1);

  const afford = (cost: number): number =>
    cost <= spendableGold
      ? 0
      : -Math.min(60, 20 + (cost - spendableGold) / 25_000);

  const capitalDeploymentPressure =
    minimumBuildCost > 0
      ? clamp(spendableGold / (minimumBuildCost * 4), 0, 1)
      : 0;
  const healthyGrowthReserve = clamp((context.reserveRatio - 0.5) / 0.4, 0, 1);
  const growthReadiness = healthyGrowthReserve * (1 - risk * 0.65);

  const scores: EconomicSystemScores = {
    bank:
      (spendableGold <= 0 ? 80 : 0) +
      (context.reserveRatio < 0.4 ? 50 : 0) +
      risk * 30 -
      capitalDeploymentPressure * growthReadiness * 18,
    "protect-assets":
      exposureRatio * 55 +
      risk * 35 +
      Math.min(18, Math.max(0, context.exposedEconomicStructures) * 3) +
      (context.defensePosts === 0 && context.exposedEconomicStructures > 0
        ? 10
        : 0) +
      afford(context.defensePostCost),
    "stack-capacity":
      cityGap * 16 +
      unstackedRatio * 28 +
      (context.trapped ? 15 : 0) +
      (context.reserveRatio < 0.55 ? 10 : 0) -
      (context.hasNeutralLand && !context.trapped ? 6 : 0) +
      capitalDeploymentPressure * growthReadiness * 10 +
      Math.min(4, cityGap) * healthyGrowthReserve * 4 +
      afford(context.cityCost),
    "activate-rail":
      (context.railStops >= 2 && context.factories === 0 ? 48 : 0) +
      (context.factories > 0 ? railGap * 45 : 0) +
      Math.min(8, productiveStopsPerFactory * 2) * railGap +
      unconnectedPortRatio * 40 +
      isolatedFactoryRatio * 32 +
      capitalDeploymentPressure * growthReadiness * 18 +
      afford(context.factoryCost),
    "extend-trade":
      portGap * 20 +
      Math.min(18, Math.max(0, context.tradePartners) * 3) +
      Math.min(16, productiveStopsPerFactory * 4) -
      unconnectedPorts * 22 -
      embargoRatio * 35 -
      risk * 15 +
      capitalDeploymentPressure * growthReadiness * 14 +
      afford(context.portCost),
  };

  const ranked = (Object.keys(scores) as EconomicSystemAction[]).sort(
    (a, b) => scores[b] - scores[a],
  );
  const action: EconomicSystemAction = spendableGold <= 0 ? "bank" : ranked[0];
  const score = scores[action];
  const partialPlan = {
    risk,
    goldReserveFloor,
    tradeCoverageTargetRatio,
  };

  return {
    action,
    score,
    scores,
    risk,
    goldReserveFloor,
    spendableGold,
    economyReturnScore:
      Math.max(scores["activate-rail"], scores["extend-trade"]) / 10,
    infrastructureNeedScore:
      Math.max(scores["protect-assets"], scores["stack-capacity"]) / 10,
    tradeCoverageTargetRatio,
    capitalDeploymentPressure,
    reason: reasonForAction(action, context, partialPlan),
  };
}

export function selectFactoryUpgradeCandidates<T>(
  candidates: readonly T[],
  score: (candidate: T) => number,
  maximumCandidates = 4,
): T[] {
  return [...candidates]
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.max(0, Math.floor(maximumCandidates)));
}
