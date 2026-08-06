import { projectLandCapacity } from "./LandCapacityPolicy";

export type LandAttackEstimate = {
  attackerTroops: number;
  defenderTroops: number;
  fraction: number;
  borderWidth: number;
  combatCost: number;
  tilesToTake: number;
};

export type AllianceDecision = {
  availableAllianceSlots: number;
  activeConflict: boolean;
  requestorIsTribe: boolean;
  preservesBestExpansionRoute: boolean;
  closesDangerousFront: boolean;
  usefulRemotePartner: boolean;
  crowdedBorders: boolean;
};

export type AttackCapacity = {
  requiredTroops: number;
  reachable: boolean;
};

export type CapacityEscapeRaidPlan = {
  fraction: number;
  targetGainRatio: number;
  deadlineTicks: number;
};

export type SeedCohortResult = {
  scoreTotal: number;
  completedSeeds: number;
  complete: boolean;
  averageScore: number;
  accepted: boolean | null;
};

export type NationFrontPolicy = {
  reserveFloor: number;
  advantageMultiplier: number;
  maxNationOffensives: number;
  desiredAlliances: number;
};

export enum LossCause {
  Unknown,
  Overextension,
  ThirdParty,
  StalledOffense,
  Containment,
  Infrastructure,
}

export function assessAttackCapacity({
  maxTroops,
  targetTroops,
  requiredAdvantage,
}: {
  maxTroops: number;
  targetTroops: number;
  requiredAdvantage: number;
}): AttackCapacity {
  const requiredTroops = Math.max(0, targetTroops * requiredAdvantage);
  return {
    requiredTroops,
    reachable: requiredTroops <= Math.max(0, maxTroops),
  };
}

/**
 * A full troop bank that cannot ever satisfy the full-conquest threshold must
 * still turn strength into land. This permits a deliberately small raid only
 * after a prolonged stall and leaves both the current front reserve plus an
 * additional buffer at home.
 */
export function planCapacityEscapeRaid({
  noGrowthTicks,
  reserveRatio,
  reserveFloor,
  incomingFronts,
  outgoingFronts,
  requiredCapacityRatio,
  terrainCost,
}: {
  noGrowthTicks: number;
  reserveRatio: number;
  reserveFloor: number;
  incomingFronts: number;
  outgoingFronts: number;
  requiredCapacityRatio: number;
  terrainCost: number;
}): CapacityEscapeRaidPlan | null {
  const protectedReserve = Math.max(0.72, reserveFloor + 0.08);
  if (
    noGrowthTicks < 240 ||
    incomingFronts > 0 ||
    outgoingFronts > 0 ||
    reserveRatio < Math.max(0.84, protectedReserve + 0.06) ||
    requiredCapacityRatio <= 1 ||
    requiredCapacityRatio > 3 ||
    !Number.isFinite(terrainCost) ||
    terrainCost > 2.25
  ) {
    return null;
  }

  const availableFraction =
    (reserveRatio - protectedReserve) / Math.max(0.01, reserveRatio);
  const fraction = Math.min(0.12, Math.max(0, availableFraction));
  if (fraction < 0.06) return null;

  return {
    fraction,
    targetGainRatio: Math.min(
      0.006,
      0.003 + Math.max(0, noGrowthTicks - 240) / 200_000,
    ),
    deadlineTicks: Math.max(42, Math.min(72, 42 + noGrowthTicks / 120)),
  };
}

/**
 * Convert an unreachable conquest requirement into a concrete city target.
 * The target advances in bounded steps so capacity can catch up without
 * committing every economic decision to cities indefinitely.
 */
export function desiredCapacityEscapeCityCount({
  baselineDesiredCities,
  ownedCities,
  noGrowthTicks,
  reserveRatio,
  incomingFronts,
  maxTroops,
  requiredTroops,
  cityTroopIncrease,
}: {
  baselineDesiredCities: number;
  ownedCities: number;
  noGrowthTicks: number;
  reserveRatio: number;
  incomingFronts: number;
  maxTroops: number;
  requiredTroops: number;
  cityTroopIncrease: number;
}): number {
  if (
    noGrowthTicks < 180 ||
    reserveRatio < 0.72 ||
    incomingFronts > 0 ||
    requiredTroops <= maxTroops
  ) {
    return baselineDesiredCities;
  }
  const gapCities = Math.max(
    1,
    Math.ceil(
      (requiredTroops * 1.05 - maxTroops) / Math.max(1, cityTroopIncrease),
    ),
  );
  const pacedCities = Math.min(
    6,
    Math.max(1, Math.ceil((noGrowthTicks - 120) / 480)),
  );
  return Math.min(
    16,
    Math.max(
      baselineDesiredCities,
      ownedCities + Math.min(gapCities, pacedCities),
    ),
  );
}

export function scoreMutationOutcome({
  won,
  alive,
  playerCount,
  finishingRank,
  raidSuccessRate,
  retaliationRate,
  transportLossRate,
  predictionQuality,
  startingTiles,
  peakTiles,
  totalLandTiles,
  elapsedTicks,
  noGrowthTicks,
  longestNoGrowthTicks,
  peakCities,
  peakFactories,
}: {
  won: boolean;
  alive: boolean;
  playerCount: number;
  finishingRank: number;
  raidSuccessRate: number;
  retaliationRate: number;
  transportLossRate: number;
  predictionQuality: number;
  startingTiles: number;
  peakTiles: number;
  totalLandTiles: number;
  elapsedTicks: number;
  noGrowthTicks: number;
  longestNoGrowthTicks: number;
  peakCities: number;
  peakFactories: number;
}): number {
  const growthMultiple = Math.max(1, peakTiles) / Math.max(1, startingTiles);
  const territoryShare = Math.max(0, peakTiles) / Math.max(1, totalLandTiles);
  const stagnationRatio =
    Math.max(noGrowthTicks, longestNoGrowthTicks) / Math.max(1, elapsedTicks);
  const growthScore =
    Math.min(420, Math.log2(Math.max(1, growthMultiple)) * 55) +
    Math.min(700, territoryShare * 7_000);
  const economyScore = Math.min(
    160,
    Math.max(0, peakCities) * 8 + Math.max(0, peakFactories) * 32,
  );
  return (
    (won ? 1_200 : 0) +
    (Math.max(1, playerCount) - Math.max(1, finishingRank)) * 2 -
    (!alive ? 150 : 0) +
    growthScore +
    economyScore -
    Math.min(360, Math.max(0, stagnationRatio) * 360) +
    Math.max(0, Math.min(1, raidSuccessRate)) * 60 -
    Math.max(0, Math.min(1, retaliationRate)) * 100 -
    Math.max(0, Math.min(1, transportLossRate)) * 100 +
    Math.max(-1, Math.min(1, predictionQuality)) * 80
  );
}

export function classifyLossCause({
  elapsedTicks,
  thirdPartyPressureTicks,
  maxIncomingRatio,
  lowReserveTicks,
  maxCommittedRatio,
  longestStallTicks,
  longestNoGrowthTicks,
  noGainTicks,
  peakTiles,
  peakCities,
}: {
  elapsedTicks: number;
  thirdPartyPressureTicks: number;
  maxIncomingRatio: number;
  lowReserveTicks: number;
  maxCommittedRatio: number;
  longestStallTicks: number;
  longestNoGrowthTicks: number;
  noGainTicks: number;
  peakTiles: number;
  peakCities: number;
}): LossCause {
  if (
    longestNoGrowthTicks >= Math.max(300, elapsedTicks * 0.18) ||
    noGainTicks >= Math.max(400, elapsedTicks * 0.22)
  ) {
    return LossCause.Containment;
  }
  if (
    thirdPartyPressureTicks >= Math.min(60, elapsedTicks * 0.18) &&
    maxIncomingRatio >= 0.3
  ) {
    return LossCause.ThirdParty;
  }
  if (lowReserveTicks >= elapsedTicks * 0.18 && maxCommittedRatio >= 0.5) {
    return LossCause.Overextension;
  }
  if (longestStallTicks >= 180) return LossCause.StalledOffense;
  if (noGainTicks >= 250 && peakTiles < 3_000) return LossCause.Containment;
  if (peakCities === 0 && (maxIncomingRatio >= 0.6 || peakTiles < 2_000)) {
    return LossCause.Infrastructure;
  }
  return LossCause.Unknown;
}

export function shouldAcceptAlliance({
  availableAllianceSlots,
  activeConflict,
  requestorIsTribe,
  preservesBestExpansionRoute,
  closesDangerousFront,
  usefulRemotePartner,
  crowdedBorders,
}: AllianceDecision): boolean {
  return (
    availableAllianceSlots > 0 &&
    !activeConflict &&
    !requestorIsTribe &&
    preservesBestExpansionRoute &&
    (closesDangerousFront || usefulRemotePartner || crowdedBorders)
  );
}

export function isStrategicallyTrapped({
  hasNeutralLand,
  hasSeaAccess,
  hostileBorders,
}: {
  hasNeutralLand: boolean;
  hasSeaAccess: boolean;
  hostileBorders: number;
}): boolean {
  return !hasNeutralLand && !hasSeaAccess && hostileBorders > 0;
}

export function railCityConnectionScore({
  hasFactoryInRange,
  stationDistancesSquared,
  minimumRange,
  maximumRange,
}: {
  hasFactoryInRange: boolean;
  stationDistancesSquared: readonly number[];
  minimumRange: number;
  maximumRange: number;
}): number {
  if (!hasFactoryInRange) return 0;
  const minimumSquared = minimumRange ** 2;
  const maximumSquared = maximumRange ** 2;
  return stationDistancesSquared.filter(
    (distance) => distance >= minimumSquared && distance <= maximumSquared,
  ).length;
}

export function railFactoryConnectionScore({
  structureDistancesSquared,
  minimumRange,
  maximumRange,
}: {
  structureDistancesSquared: readonly number[];
  minimumRange: number;
  maximumRange: number;
}): number {
  const minimumSquared = minimumRange ** 2;
  const maximumSquared = maximumRange ** 2;
  return structureDistancesSquared.filter(
    (distance) => distance >= minimumSquared && distance <= maximumSquared,
  ).length;
}

export type CityStackPlacementScore = {
  score: number;
  nearbyCities: number;
  nearestCityDistance: number | null;
  stacked: boolean;
};

/**
 * Prefer a tight, legal ring around an existing city instead of scattering
 * every capacity investment across the interior. The ring is derived from the
 * engine's structure spacing, so it scales with game configuration and maps.
 */
export function scoreCityStackPlacement({
  cityDistancesSquared,
  structureMinDistance,
}: {
  cityDistancesSquared: readonly number[];
  structureMinDistance: number;
}): CityStackPlacementScore {
  const minimum = Math.max(1, structureMinDistance);
  const distances = cityDistancesSquared
    .filter((distance) => Number.isFinite(distance) && distance >= 0)
    .map((distance) => Math.sqrt(distance))
    .sort((a, b) => a - b);
  const nearestCityDistance = distances[0] ?? null;
  if (nearestCityDistance === null) {
    return {
      score: 0,
      nearbyCities: 0,
      nearestCityDistance: null,
      stacked: false,
    };
  }

  const stackRadius = minimum * 2.25;
  const nearbyCities = distances.filter(
    (distance) => distance <= stackRadius,
  ).length;
  const stacked =
    nearestCityDistance >= minimum * 0.95 && nearestCityDistance <= stackRadius;
  if (!stacked) {
    return {
      score: 0,
      nearbyCities,
      nearestCityDistance,
      stacked: false,
    };
  }

  const idealDistance = minimum * 1.1;
  const radialAccuracy =
    1 -
    Math.min(
      1,
      Math.abs(nearestCityDistance - idealDistance) /
        Math.max(1, stackRadius - idealDistance),
    );
  return {
    score: radialAccuracy * 100 + Math.min(3, nearbyCities) * 24,
    nearbyCities,
    nearestCityDistance,
    stacked: true,
  };
}

export type FactoryPlacementScore = {
  score: number;
  productiveStops: number;
  railEfficiency: number;
};

/**
 * Rank a factory by productive train stops and the route the engine will
 * actually create. Existing rail, short straight paths, safe depth, and
 * non-embargoed external stops beat an isolated or redundant placement.
 */
export function scoreFactoryPlacement({
  ownCities,
  ownPorts,
  externalCities,
  externalPorts,
  factoryCorridorConnections,
  overlappingRailroads,
  ghostPathLengths,
  railBends,
  depth,
  safestDepth,
  nearestFactoryDistance,
  minimumRange,
  maximumRange,
}: {
  ownCities: number;
  ownPorts: number;
  externalCities: number;
  externalPorts: number;
  factoryCorridorConnections: number;
  overlappingRailroads: number;
  ghostPathLengths: readonly number[];
  railBends: number;
  depth: number;
  safestDepth: number;
  nearestFactoryDistance?: number;
  minimumRange: number;
  maximumRange: number;
}): FactoryPlacementScore {
  const ownStopValue = Math.max(0, ownCities) + Math.max(0, ownPorts) * 1.3;
  const externalStopValue =
    Math.max(0, externalCities) * 1.25 + Math.max(0, externalPorts) * 1.6;
  const productiveStops =
    Math.max(0, ownCities) +
    Math.max(0, ownPorts) +
    Math.max(0, externalCities) +
    Math.max(0, externalPorts);
  const pathTiles = ghostPathLengths.reduce(
    (sum, length) => sum + Math.max(0, length),
    0,
  );
  const routeCount =
    ghostPathLengths.filter((length) => length > 0).length +
    (overlappingRailroads > 0 ? 1 : 0);
  const railEfficiency =
    routeCount === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            1 -
              Math.max(0, railBends) / Math.max(1, pathTiles - routeCount) -
              (pathTiles /
                Math.max(1, routeCount * Math.max(1, maximumRange))) *
                0.2,
          ),
        );
  const safety = Math.max(
    0,
    Math.min(1, Math.max(0, depth) / Math.max(1, safestDepth)),
  );
  const minimum = Math.max(1, minimumRange);
  const maximum = Math.max(minimum, maximumRange);
  const redundancyPenalty =
    nearestFactoryDistance !== undefined &&
    nearestFactoryDistance < Math.max(minimum, maximum * 0.35)
      ? 40 *
        (1 -
          Math.max(0, nearestFactoryDistance - minimum) /
            Math.max(1, maximum * 0.35 - minimum))
      : 0;

  return {
    score:
      ownStopValue * 22 +
      externalStopValue * 30 +
      Math.max(0, factoryCorridorConnections) * 8 +
      Math.min(3, routeCount) * 12 +
      Math.max(0, overlappingRailroads) * 18 +
      railEfficiency * 24 +
      safety * 24 -
      redundancyPenalty,
    productiveStops,
    railEfficiency,
  };
}

export function estimateTradeRouteGold(
  distance: number,
  shortRangeDebuff = 300,
): number {
  return Math.floor(
    75_000 / (1 + Math.exp(-0.03 * (distance - shortRangeDebuff))) +
      50 * distance,
  );
}

/**
 * One factory is enough to establish the early rail economy. Additional
 * factories are late-game throughput investments and require a city network,
 * territory, healthy reserves, and enough surplus gold to avoid crowding out
 * troop-capacity construction.
 */
export function desiredFactoryCount({
  economicStops,
  ownedCities,
  ownedTiles,
  gold,
  reserveRatio,
}: {
  economicStops: number;
  ownedCities: number;
  ownedTiles: number;
  gold: number;
  reserveRatio: number;
}): number {
  if (economicStops < 2 || ownedCities < 2) return 0;
  if (
    ownedCities >= 10 &&
    ownedTiles >= 12_000 &&
    gold >= 5_000_000 &&
    reserveRatio >= 0.65
  ) {
    return 3;
  }
  if (
    ownedCities >= 6 &&
    ownedTiles >= 6_000 &&
    gold >= 2_000_000 &&
    reserveRatio >= 0.55
  ) {
    return 2;
  }
  return 1;
}

export function shouldBuildCapacityCity({
  reserveRatio,
  hasNeutralLand,
  trapped,
  railConnections,
}: {
  reserveRatio: number;
  hasNeutralLand: boolean;
  trapped: boolean;
  railConnections: number;
}): boolean {
  return (
    trapped || railConnections > 0 || !hasNeutralLand || reserveRatio >= 0.72
  );
}

/**
 * Scale the minimum city count with the number of hostile fronts. Cities are
 * both troop capacity and a safe regeneration anchor, so a crowded border
 * needs more of them before the AI spends gold on optional upgrades.
 */
export function desiredDefensiveCityCount({
  enemyFronts,
  activeWars,
  incomingFronts,
  ownedCities,
  ownedTiles,
  reserveRatio,
  incomingTroopRatio = 0,
}: {
  enemyFronts: number;
  activeWars: number;
  incomingFronts: number;
  ownedCities: number;
  ownedTiles: number;
  reserveRatio: number;
  incomingTroopRatio?: number;
}): number {
  const hostilePressure =
    Math.max(0, enemyFronts) * 1.5 +
    Math.max(0, activeWars) * 2 +
    Math.max(0, incomingFronts) * 2.5;
  const territoryBaseline = Math.max(
    0,
    Math.ceil(Math.max(0, ownedTiles) / 1_000) - 1,
  );
  const reserveBuffer = reserveRatio < 0.5 ? 1 : 0;
  const overwhelmingBuffer = Math.ceil(
    Math.max(0, incomingTroopRatio - 0.5) * 2,
  );
  const pressureCities = Math.ceil(hostilePressure / 2);
  return Math.max(
    Math.max(0, ownedCities),
    Math.min(
      16,
      pressureCities + territoryBaseline + reserveBuffer + overwhelmingBuffer,
    ),
  );
}

export type WildernessGrowthEstimate = {
  projectedMaxTroops: number;
  capacityGain: number;
  regenerationMultiplier: number;
  worthwhile: boolean;
};

/**
 * Territory raises max troops non-linearly, and regeneration scales with the
 * empty-capacity ratio. Use this before an opening pulse so the trainer can
 * recognize that early wilderness is also an army-capacity investment.
 */
export function estimateWildernessGrowth({
  currentTiles,
  projectedTiles,
  currentMaxTroops,
  reserveRatio,
}: {
  currentTiles: number;
  projectedTiles: number;
  currentMaxTroops: number;
  reserveRatio: number;
}): WildernessGrowthEstimate {
  const projection = projectLandCapacity({
    currentTiles,
    projectedTiles,
    currentMaxTroops,
    currentTroops: currentMaxTroops * Math.max(0, Math.min(1, reserveRatio)),
  });
  return {
    projectedMaxTroops: projection.projectedMaxTroops,
    capacityGain: projection.capacityGain,
    regenerationMultiplier: projection.regenerationMultiplier,
    worthwhile: projection.worthwhile,
  };
}

/** Tribes can be captured quickly when the attacker has a decisive 2× edge. */
export function tribeAttackCommitmentMultiplier(
  attackerTroops: number,
  defenderTroops: number,
): number {
  return attackerTroops >= Math.max(1, defenderTroops) * 2 ? 2 : 1.08;
}

/** Preserve a survivable outer border while troops refill at a faster rate. */
export function shouldTradeLandForTime({
  reserveRatio,
  incomingTroopRatio,
  activeIncomingFronts,
}: {
  reserveRatio: number;
  incomingTroopRatio: number;
  activeIncomingFronts: number;
}): boolean {
  return (
    reserveRatio <= 0.5 && incomingTroopRatio < 0.75 && activeIncomingFronts > 0
  );
}

export function nationFrontPolicy({
  nationFronts,
  activeNationWars,
}: {
  nationFronts: number;
  activeNationWars: number;
}): NationFrontPolicy {
  const extraFronts = Math.max(0, nationFronts - 1);
  return {
    reserveFloor: Math.min(
      0.8,
      0.48 + extraFronts * 0.08 + activeNationWars * 0.08,
    ),
    advantageMultiplier: Math.min(
      1.9,
      1.25 + extraFronts * 0.15 + activeNationWars * 0.12,
    ),
    // Never open a second nation war, but do not let several quiet borders
    // permanently deadlock expansion. Reserve and advantage requirements above
    // already rise with every exposed front.
    // This is a concurrency limit, not a count of remembered enemies. An
    // existing war with no active squad must still be allowed to resume.
    maxNationOffensives: 1,
    desiredAlliances: nationFronts >= 3 ? 2 : nationFronts > 0 ? 1 : 0,
  };
}

/**
 * Land concurrency only counts wars that can currently use a land border.
 * Remembered remote enemies stay available to naval and strategic planners,
 * but must not prevent an attack on the sole reachable neighboring nation.
 */
export function nationLandFrontAllowed({
  isNation,
  targetID,
  activeBorderWarIDs,
  activeOffensiveIDs,
  maxNationOffensives,
}: {
  isNation: boolean;
  targetID: string;
  activeBorderWarIDs: ReadonlySet<string>;
  activeOffensiveIDs: ReadonlySet<string>;
  maxNationOffensives: number;
}): boolean {
  return (
    !isNation ||
    activeBorderWarIDs.has(targetID) ||
    activeOffensiveIDs.has(targetID) ||
    (activeBorderWarIDs.size === 0 &&
      activeOffensiveIDs.size < maxNationOffensives)
  );
}

/**
 * Optional land-grab raids expose the home bank to opportunistic neighbors.
 * Scale that gamble by total border exposure and total army strength rather
 * than treating an inexpensive local tile density as global safety.
 */
export function shouldRiskDenialRaid({
  isTribe,
  nationBorders,
  targetTroops,
  ourTroops,
  targetDistracted,
  reserveRatio,
}: {
  isTribe: boolean;
  nationBorders: number;
  targetTroops: number;
  ourTroops: number;
  targetDistracted: boolean;
  reserveRatio: number;
}): boolean {
  if (isTribe) return true;
  const targetTroopRatio = Math.max(0, targetTroops) / Math.max(1, ourTroops);
  if (nationBorders >= 4) {
    return reserveRatio >= 0.9 && targetDistracted && targetTroopRatio <= 0.75;
  }
  if (nationBorders === 3) {
    return (
      reserveRatio >= 0.84 &&
      targetTroopRatio <= 1 &&
      (targetDistracted || targetTroopRatio <= 0.65)
    );
  }
  return true;
}

/**
 * Keep enough troops home to slow hostile tile capture without waiting for an
 * impossible bank. Normal land attacks default to roughly 20% of the enemy's
 * home troops. Config.attackLogic reaches useful per-tile resistance when the
 * defender holds about 5× that squad, or roughly the enemy's current bank.
 * More exposed fronts increase the target, but it remains attainable.
 */
export function desiredBankedTroops({
  maxTroops,
  enemyTroops,
  enemyMaxTroops,
  enemyFronts,
  reserveFloor,
  isTribe,
}: {
  maxTroops: number;
  enemyTroops: number;
  enemyMaxTroops?: number;
  enemyFronts: number;
  reserveFloor: number;
  isTribe: boolean;
}): number {
  const safeCapacity = Math.max(0, maxTroops) * Math.max(0, reserveFloor);
  if (isTribe) {
    return Math.min(
      Math.max(0, maxTroops) * 0.75,
      Math.max(safeCapacity, Math.max(0, enemyTroops) * 0.5),
    );
  }
  const frontSlowdownRatio = Math.min(
    1.5,
    1 + Math.max(0, enemyFronts - 1) * 0.2,
  );
  const currentCaptureThreat = Math.max(0, enemyTroops) * frontSlowdownRatio;
  const futureCaptureThreat = Math.max(0, enemyMaxTroops ?? enemyTroops) * 0.65;
  return Math.min(
    Math.max(0, maxTroops) * 0.92,
    Math.max(safeCapacity, currentCaptureThreat, futureCaptureThreat),
  );
}

/** Keep transports from becoming an unescorted second army. */
export function desiredFleetTroopBank({
  maxTroops,
  nearbyHostileWarships,
  ownWarships,
  hasTradeTarget,
}: {
  maxTroops: number;
  nearbyHostileWarships: number;
  ownWarships: number;
  hasTradeTarget: boolean;
}): number {
  const base = hasTradeTarget ? 0.2 : 0.28;
  const escortPenalty = nearbyHostileWarships > ownWarships ? 0.08 : 0;
  return Math.floor(
    Math.max(0, maxTroops) * Math.max(0.1, base - escortPenalty),
  );
}

export type PredictionAction =
  "hold" | "attack" | "expand" | "defend" | "fleet";

export type FuturePrediction = {
  action: PredictionAction;
  horizon: number;
  expectedTroops: number;
  expectedTiles: number;
  confidence: number;
};

/** Cheap, deterministic forward model used for portable action traces. */
export function predictFutureOutcome({
  action,
  troops,
  maxTroops,
  tiles,
  enemyTroops,
  horizon,
  sample,
}: {
  action: PredictionAction;
  troops: number;
  maxTroops: number;
  tiles: number;
  enemyTroops: number;
  horizon: number;
  sample: number;
}): FuturePrediction {
  const safeMax = Math.max(1, maxTroops);
  const reserve = Math.max(0, Math.min(1, troops / safeMax));
  const uncertainty = 1 + (sample - 2) * 0.04;
  const regeneration =
    Math.max(0, 10 + Math.pow(Math.max(0, troops), 0.73) / 4) *
    (1 - reserve) *
    horizon;
  const attackPower = Math.min(troops * 0.4, enemyTroops * 0.9) * uncertainty;
  const expectedTroops = Math.max(
    0,
    Math.min(
      safeMax,
      troops +
        (action === "hold" || action === "defend" ? regeneration : 0) -
        (action === "attack"
          ? attackPower
          : action === "expand"
            ? troops * 0.16
            : action === "fleet"
              ? troops * 0.12
              : 0),
    ),
  );
  const expectedTiles =
    tiles +
    (action === "attack"
      ? Math.max(0, attackPower / Math.max(1, enemyTroops)) * tiles * 0.08
      : action === "expand"
        ? Math.max(1, tiles * 0.04)
        : 0);
  return {
    action,
    horizon,
    expectedTroops,
    expectedTiles,
    confidence: Math.max(0.1, 1 - Math.abs(sample - 2) * 0.12),
  };
}

export function predictFutureOutcomes(
  input: Omit<Parameters<typeof predictFutureOutcome>[0], "sample">,
): FuturePrediction[] {
  return [0, 1, 2, 3, 4].map((sample) =>
    predictFutureOutcome({ ...input, sample }),
  );
}

export function desiredWarshipCount({
  nearbyHostileWarships,
  nearbyHostileTransports,
  vulnerableTradeShips,
  navalBias,
}: {
  nearbyHostileWarships: number;
  nearbyHostileTransports: number;
  vulnerableTradeShips: number;
  navalBias: number;
}): number {
  const defensiveDemand = Math.min(
    8,
    nearbyHostileWarships + Math.ceil(nearbyHostileTransports / 2),
  );
  // Once enemy trade traffic exists, extra ships generate more captures,
  // veterancy, map control, and therefore more gold. Keep commissioning ships
  // aggressively instead of stopping at a token raiding fleet and hoarding cash.
  const raidingDemand =
    vulnerableTradeShips > 0
      ? Math.min(
          3,
          1 +
            Math.min(1, Math.ceil(vulnerableTradeShips / 5)) +
            Math.round(Math.max(0, navalBias) * 0.25),
        )
      : 0;
  return Math.max(defensiveDemand, raidingDemand);
}

export function evaluateSeedCohort({
  scoreTotal,
  completedSeeds,
  nextScore,
  requiredSeeds,
  baselineScore,
  firstGeneration,
}: {
  scoreTotal: number;
  completedSeeds: number;
  nextScore: number;
  requiredSeeds: number;
  baselineScore: number;
  firstGeneration: boolean;
}): SeedCohortResult {
  const total = scoreTotal + nextScore;
  const completed = completedSeeds + 1;
  const complete = completed >= Math.max(1, requiredSeeds);
  const averageScore = total / completed;
  return {
    scoreTotal: total,
    completedSeeds: completed,
    complete,
    averageScore,
    accepted: complete
      ? firstGeneration || averageScore >= baselineScore
      : null,
  };
}

export function minimumDefensePostDepth(
  canCreateLandBuffer: boolean,
  defenseRange: number,
): number {
  return Math.max(
    2,
    Math.floor(defenseRange * (canCreateLandBuffer ? 0.35 : 0.7)),
  );
}

/**
 * Mirrors both Config.attackTilesPerTick's front budget and attackLogic's
 * per-tile defender resistance. The resistance is normalized around the
 * estimator's original 0.5 baseline so existing terrain costs remain useful.
 */
export function estimateLandAttackTicks({
  attackerTroops,
  defenderTroops,
  fraction,
  borderWidth,
  combatCost,
  tilesToTake,
}: LandAttackEstimate): number {
  const committedTroops = Math.max(1, attackerTroops * fraction);
  const relativeProgress = Math.max(
    0.01,
    Math.min(0.5, (10 * committedTroops) / Math.max(1, defenderTroops)),
  );
  const progressBudgetPerTick = relativeProgress * Math.max(1, borderWidth) * 3;
  const defenderResistance =
    Math.max(
      0.2,
      Math.min(1.5, Math.max(0, defenderTroops) / (5 * committedTroops)),
    ) / 0.5;
  const effectiveTilesPerTick =
    progressBudgetPerTick / (Math.max(0.5, combatCost) * defenderResistance);
  return Math.ceil(Math.max(1, tilesToTake) / effectiveTilesPerTick);
}
