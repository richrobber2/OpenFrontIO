export function overseasExpansionValue(context: {
  landTiles: number;
  ports: number;
  troopDensity: number;
  normalizedDistance: number;
  isTribe: boolean;
  opensNationWar: boolean;
}): number {
  const landValue = Math.log2(1 + Math.max(0, context.landTiles)) * 10;
  const portValue = Math.max(0, context.ports) * 24;
  const tribeValue = context.isTribe ? 42 : 0;
  const warPenalty = context.opensNationWar ? 60 : 0;
  const densityPenalty = Math.log2(1 + Math.max(0, context.troopDensity)) * 18;
  const distancePenalty = Math.max(0, context.normalizedDistance) * 40;
  return (
    landValue +
    portValue +
    tribeValue -
    warPenalty -
    densityPenalty -
    distancePenalty
  );
}

export function navalLaunchDelayTicks(context: {
  maximumTransports: number;
  activeTransports: number;
  transportLossRate: number;
  earlyExpansion?: boolean;
  isTribe?: boolean;
}): number {
  const openSlots = Math.max(
    0,
    Math.floor(context.maximumTransports - context.activeTransports),
  );
  const lossPenalty = Math.round(
    Math.max(0, Math.min(1, context.transportLossRate)) * 80,
  );
  const earlyTribe =
    context.earlyExpansion === true && context.isTribe === true;
  const baseDelay = earlyTribe ? 120 : 170;
  const minimumDelay = earlyTribe ? 60 : 80;
  return Math.max(
    minimumDelay,
    Math.min(240, baseDelay - openSlots * 15 + lossPenalty),
  );
}

export function minimumNavalLaunchReserveRatio(
  ticks: number,
  standardReserveRatio: number,
): number {
  const standard = Math.max(0, Math.min(1, standardReserveRatio));
  return ticks < 2_500 ? Math.max(standard, 0.85) : standard;
}

export function maximumNavalInterceptionRisk(context: {
  transportLossRate: number;
  navalGene: number;
  cautionGene: number;
  noLandFront: boolean;
  reserveRatio: number;
}): number {
  const learnedLossRate = Math.max(0, Math.min(1, context.transportLossRate));
  const baseTolerance =
    0.3 -
    learnedLossRate * 0.18 +
    context.navalGene * 0.08 -
    context.cautionGene * 0.03;
  const trappedOverflowBonus =
    context.noLandFront && context.reserveRatio >= 0.9
      ? 0.12 + Math.min(0.08, (context.reserveRatio - 0.9) * 0.8)
      : 0;
  return Math.max(0.12, Math.min(0.58, baseTolerance + trappedOverflowBonus));
}

export function preferTribeExpansionTargets<
  T extends {
    isTribe: boolean;
    earlyPortOpportunity?: boolean;
    navalRemnantOpportunity?: boolean;
  },
>(targets: readonly T[]): T[] {
  // Generic distant nations are not a growth plan. Keep tribes and only the
  // two explicit nation exceptions whose force checks are intentionally strict.
  return targets.filter(
    (target) =>
      target.isTribe ||
      target.earlyPortOpportunity === true ||
      target.navalRemnantOpportunity === true,
  );
}

export function isNavalRemnantOpportunity(context: {
  ownTroops: number;
  ownTiles: number;
  targetTroops: number;
  targetTiles: number;
  targetIsAllied: boolean;
}): boolean {
  if (context.targetIsAllied) return false;
  const forceRatio =
    Math.max(0, context.targetTroops) / Math.max(1, context.ownTroops);
  const territoryRatio =
    Math.max(0, context.targetTiles) / Math.max(1, context.ownTiles);
  return (
    (forceRatio <= 0.1 && territoryRatio <= 0.06) ||
    (context.targetTiles <= 1_500 && forceRatio <= 0.16)
  );
}

export function transportRecallThreshold(context: {
  targetIsTribe: boolean;
  targetForceRatio: number;
  learnedLossRate: number;
}): number {
  const weakTargetBonus =
    Math.max(0, 0.25 - Math.max(0, context.targetForceRatio)) * 0.4;
  const commitmentBonus = context.targetIsTribe ? 0.16 : 0;
  const lossPenalty = Math.max(0, Math.min(1, context.learnedLossRate)) * 0.12;
  return Math.max(
    0.58,
    Math.min(0.94, 0.7 + weakTargetBonus + commitmentBonus - lossPenalty),
  );
}

export function earlyPortSeizureValue(context: {
  ticks: number;
  enemyPorts: number;
  enemyWarships: number;
  enemyToOwnTroopRatio: number;
}): number {
  const maximumForceRatio = 0.16;
  if (
    context.ticks >= 2_000 ||
    context.enemyPorts <= 0 ||
    context.enemyWarships > 0 ||
    context.enemyToOwnTroopRatio > maximumForceRatio
  ) {
    return 0;
  }
  return (
    55 +
    Math.max(0, context.enemyPorts - 1) * 18 +
    (maximumForceRatio - Math.max(0, context.enemyToOwnTroopRatio)) * 100
  );
}

export function prioritizePortLandingTiles(
  shoreTiles: readonly number[],
  portTiles: readonly number[],
  maximumTiles: number,
): number[] {
  const limit = Math.max(0, Math.floor(maximumTiles));
  if (limit === 0) return [];
  const ports = [...new Set(portTiles)].slice(0, Math.min(4, limit));
  const portSet = new Set(ports);
  const remaining = [...new Set(shoreTiles)].filter(
    (tile) => !portSet.has(tile),
  );
  const slots = limit - ports.length;
  if (remaining.length <= slots) return [...ports, ...remaining];
  const sampled = Array.from(
    { length: slots },
    (_, index) =>
      remaining[
        Math.floor((index * (remaining.length - 1)) / Math.max(1, slots - 1))
      ],
  );
  return [...ports, ...sampled];
}

export function relativeOverseasLaunchTroops(context: {
  enemyTroops: number;
  requiredLandingAdvantage: number;
  minimumLaunchTroops: number;
  maximumLaunchTroops: number;
  safetyMargin?: number;
}): number {
  const maximum = Math.max(0, Math.floor(context.maximumLaunchTroops));
  const minimum = Math.max(0, Math.ceil(context.minimumLaunchTroops));
  const required = Math.ceil(
    Math.max(0, context.enemyTroops) *
      Math.max(0, context.requiredLandingAdvantage) *
      Math.max(1, context.safetyMargin ?? 1.2),
  );

  // Returning the maximum when it cannot satisfy the landing requirement
  // converts an impossible route into a doomed attack. Zero makes the caller
  // reject it and preserve the troops for local growth.
  if (required > maximum) return 0;
  return Math.max(0, Math.min(maximum, Math.max(minimum, required)));
}
