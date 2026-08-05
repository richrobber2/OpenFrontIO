export interface StrategicStructureTarget {
  id: string;
  kind: "missile-silo" | "sam" | "factory" | "port" | "city" | "defense-post";
  distance: number;
  estimatedDefense: number;
  exposed: boolean;
  containsReadyWeapon?: boolean;
  ownerPowerRatio: number;
  coastalAccess?: boolean;
}

export interface ShipyardSite {
  id: string;
  shorelineLength: number;
  openWaterDirections: number;
  nearbyFriendlyShipyards: number;
  nearbyEnemyWarships: number;
  distanceToCoastalTargets: number;
  distanceToFriendlyFactory: number;
  railConnected: boolean;
  threatenedBorderPressure: number;
  projectedWarshipThroughput: number;
  marginalStackValue?: number;
}

export interface ShipyardPlacementContext {
  goldSurplusRatio: number;
  existingShipyards: number;
  coastalTargets: number;
  maximumPlacements: number;
  allowStacking: boolean;
  requireFactoryConnection?: boolean;
  urgency?: number;
  targetCoverageRatio?: number;
  minimumSiteQuality?: number;
  stackingLoadRatio?: number;
  stackingLoadThreshold?: number;
  sites: ShipyardSite[];
}

export interface ShipyardPlacementPlan {
  siteIDs: string[];
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function rankStrategicStructureTargets(
  targets: StrategicStructureTarget[],
): StrategicStructureTarget[] {
  return [...targets].sort((a, b) => targetScore(b) - targetScore(a));
}

export function targetScore(target: StrategicStructureTarget): number {
  const kindValue: Record<StrategicStructureTarget["kind"], number> = {
    "missile-silo": 100,
    sam: 58,
    factory: 52,
    port: 48,
    city: 36,
    "defense-post": 24,
  };
  const readyWeaponBonus =
    target.kind === "missile-silo" && target.containsReadyWeapon ? 75 : 0;
  const exposureBonus = target.exposed ? 24 : 0;
  const coastalBonus = target.coastalAccess ? 12 : 0;
  const rivalPenalty = Math.max(0, target.ownerPowerRatio - 1) * 18;
  const defensePenalty = Math.max(0, target.estimatedDefense) * 0.7;
  const distancePenalty = Math.sqrt(Math.max(0, target.distance)) * 2.5;
  return (
    kindValue[target.kind] +
    readyWeaponBonus +
    exposureBonus +
    coastalBonus -
    rivalPenalty -
    defensePenalty -
    distancePenalty
  );
}

export function planShipyardPlacements(
  context: ShipyardPlacementContext,
): ShipyardPlacementPlan {
  const placementLimit = Math.max(0, Math.floor(context.maximumPlacements));
  if (placementLimit === 0 || context.coastalTargets <= 0) {
    return { siteIDs: [], reason: "no useful coastal deployment capacity" };
  }

  const adaptive = context.urgency !== undefined;
  if (adaptive) {
    const maximum = (select: (site: ShipyardSite) => number): number =>
      Math.max(0, ...context.sites.map(select));
    const maximumTargetDistance = maximum(
      (site) => site.distanceToCoastalTargets,
    );
    const maximumFactoryDistance = maximum(
      (site) => site.distanceToFriendlyFactory,
    );
    const maximumEnemyFleet = maximum((site) => site.nearbyEnemyWarships);
    const maximumCrowding = maximum((site) => site.nearbyFriendlyShipyards);
    const maximumSeaAccess = maximum((site) => site.openWaterDirections);
    const maximumShoreline = maximum((site) => site.shorelineLength);
    const maximumThroughput = maximum(
      (site) => site.projectedWarshipThroughput,
    );
    const relative = (value: number, maximumValue: number): number =>
      maximumValue <= 0 ? 0 : clamp(value / maximumValue, 0, 1);
    const inverseRelative = (value: number, maximumValue: number): number =>
      maximumValue <= 0 ? 1 : 1 - relative(value, maximumValue);
    const stackingAllowed =
      context.allowStacking &&
      (context.stackingLoadRatio ?? 0) >=
        (context.stackingLoadThreshold ?? 1) &&
      context.goldSurplusRatio >= 1;
    const minimumSiteQuality = clamp(context.minimumSiteQuality ?? 0.5, 0, 1);
    const scored = context.sites
      .map((site) => {
        const seaAccess = relative(site.openWaterDirections, maximumSeaAccess);
        const shoreline = relative(site.shorelineLength, maximumShoreline);
        const targetAccess = inverseRelative(
          site.distanceToCoastalTargets,
          maximumTargetDistance,
        );
        const throughput = relative(
          site.projectedWarshipThroughput,
          maximumThroughput,
        );
        const factoryAccess = inverseRelative(
          site.distanceToFriendlyFactory,
          maximumFactoryDistance,
        );
        const enemyFleetRatio = relative(
          site.nearbyEnemyWarships,
          maximumEnemyFleet,
        );
        const crowdingRatio = relative(
          site.nearbyFriendlyShipyards,
          maximumCrowding,
        );
        const stackValue = clamp(site.marginalStackValue ?? 0, 0, 1);
        const quality =
          seaAccess * 0.18 +
          shoreline * 0.1 +
          targetAccess * 0.15 +
          throughput * 0.15 +
          factoryAccess * 0.14 +
          Number(site.railConnected) * 0.16 +
          (stackingAllowed ? stackValue * 0.12 : 0) -
          clamp(site.threatenedBorderPressure, 0, 1) * 0.08 -
          enemyFleetRatio * 0.06 -
          crowdingRatio * 0.08;
        return { site, quality };
      })
      .filter(({ quality, site }) => {
        if (quality < minimumSiteQuality) return false;
        if (context.requireFactoryConnection === true && !site.railConnected) {
          return false;
        }
        if (!stackingAllowed && site.nearbyFriendlyShipyards > 0) return false;
        if (stackingAllowed && site.nearbyFriendlyShipyards > 0) {
          return (
            (site.marginalStackValue ?? 0) >=
            (context.stackingLoadThreshold ?? 1)
          );
        }
        return true;
      })
      .sort((a, b) => b.quality - a.quality);
    const desiredTotal = Math.min(
      placementLimit,
      Math.max(
        1,
        Math.ceil(
          context.coastalTargets *
            clamp(context.targetCoverageRatio ?? 0.5, 0, 1),
        ),
      ),
    );
    const targetCount = Math.max(0, desiredTotal - context.existingShipyards);

    return {
      siteIDs: scored.slice(0, targetCount).map(({ site }) => site.id),
      reason:
        scored.length === 0
          ? "no shoreline clears the adaptive quality and connection ratios"
          : stackingAllowed
            ? "repair load and budget ratios justify proportional shipyard stacking"
            : context.requireFactoryConnection
              ? "adaptive coverage selects factory-connected shoreline by relative quality"
              : "adaptive local pressure selects the strongest proportional shoreline coverage",
    };
  }

  const runawayTreasury = context.goldSurplusRatio >= 20;
  const stackingAllowed = context.allowStacking && runawayTreasury;
  const scored = context.sites
    .map((site) => {
      const seaAccess = clamp(site.openWaterDirections / 6, 0, 1) * 30;
      const shoreline = clamp(site.shorelineLength / 12, 0, 1) * 16;
      const targetAccess =
        Math.max(0, 250 - site.distanceToCoastalTargets) * 0.18;
      const throughput = Math.max(0, site.projectedWarshipThroughput) * 12;
      const factorySupport =
        Math.max(0, 180 - site.distanceToFriendlyFactory) * 0.1 +
        (site.railConnected ? 28 : 0);
      const threatPenalty = clamp(site.threatenedBorderPressure, 0, 1) * 35;
      const enemyFleetPenalty = site.nearbyEnemyWarships * 5;
      const crowdingPenalty = site.nearbyFriendlyShipyards * 8;
      const stackValue = site.marginalStackValue ?? 0;
      const score =
        seaAccess +
        shoreline +
        targetAccess +
        throughput +
        factorySupport +
        (stackingAllowed ? stackValue * 10 : 0) -
        threatPenalty -
        enemyFleetPenalty -
        crowdingPenalty;
      return { site, score };
    })
    .filter(({ score, site }) => {
      if (score < 20) return false;
      if (context.requireFactoryConnection && !site.railConnected) return false;
      if (!stackingAllowed && site.nearbyFriendlyShipyards > 0) return false;
      if (stackingAllowed && site.nearbyFriendlyShipyards > 0) {
        return (site.marginalStackValue ?? 0) > 0.25;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const desiredTotal = runawayTreasury
    ? Math.min(placementLimit, Math.max(4, context.coastalTargets * 2))
    : Math.min(placementLimit, Math.max(1, context.coastalTargets));
  const targetCount = Math.max(0, desiredTotal - context.existingShipyards);

  return {
    siteIDs: scored.slice(0, targetCount).map(({ site }) => site.id),
    reason:
      scored.length === 0
        ? "no shipyard site has enough safe naval throughput"
        : stackingAllowed
          ? "mass-place and stack shipyards where marginal naval throughput remains positive"
          : context.requireFactoryConnection
            ? "place shipyards only on open shoreline inside a factory rail catchment"
            : "place shipyards on open, supported shoreline near coastal targets",
  };
}
