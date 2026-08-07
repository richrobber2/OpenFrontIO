import { assessStrategicRouteRust } from "../rust/OpenFrontWasmDefense";

export type StrategicWeaponKind = "nuke" | "mirv";

export interface StrategicStrikeContext {
  weapon: StrategicWeaponKind;
  targetTroops: number;
  targetStructures: number;
  targetTerritoryShare: number;
  targetActiveWars: number;
  targetHasSamCoverage: boolean;
  targetIsWinning: boolean;
  targetIsAlly: boolean;
  ownReserveRatio: number;
  ownActiveNationWars: number;
  availableWeapons: number;
  ticksSinceLastStrike: number;
  ownCollateralTiles?: number;
  alliedCollateralTiles?: number;
  ownUnitsAtRisk?: number;
  alliedUnitsAtRisk?: number;
  wideAreaFriendlyBoundaryRisk?: boolean;
  expectedTroopLoss?: number;
  affectedTargetTiles?: number;
  targetTotalTiles?: number;
  destroyedStructureValue?: number;
  thirdPartyCollateralTiles?: number;
  pathBlocked?: boolean;
  samInterceptionCapacity?: number;
  requiredSalvoSize?: number;
  weaponCost?: number;
  spendableGold?: number;
}

export interface StrategicStrikeDecision {
  fire: boolean;
  score: number;
  reasons: string[];
}

export interface StrategicCapabilityContext {
  ownSilos: number;
  readyLaunchSlots: number;
  affordableWeapons: number;
  actionableTargets: number;
  enemySilos: number;
  highestThreat: number;
  reserveRatio: number;
  incomingPressureRatio: number;
  activeNationWars: number;
  gold: number;
  reserveGold: number;
  siloCost: number;
}

export interface StrategicCapabilityPlan {
  canFire: boolean;
  shouldBuildSilo: boolean;
  desiredSilos: number;
  opportunityValue: number;
  reason: string;
}

export interface StrategicRoutePoint {
  x: number;
  y: number;
  blocked: boolean;
}

export interface StrategicRouteSam {
  id: number;
  x: number;
  y: number;
  range: number;
  availableInterceptions: number;
}

export interface StrategicRouteAssessment {
  blocked: boolean;
  interceptingSams: number;
  interceptionCapacity: number;
}

// This only prevents duplicate intents against the same stale client state.
// Missile availability is governed by each silo's real 90-tick reload queue.
export const STRATEGIC_STRIKE_COOLDOWN_TICKS = 1;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

/**
 * The engine removes five times the current per-tile troop share for every
 * conventional nuke tile. This closed form mirrors the repeated update without
 * looping over thousands of blast tiles for every candidate.
 */
export function estimateConventionalNukeTroopLoss({
  troops,
  totalTiles,
  affectedTiles,
}: {
  troops: number;
  totalTiles: number;
  affectedTiles: number;
}): number {
  const tiles = Math.max(1, Math.floor(totalTiles));
  const impacted = clamp(Math.floor(affectedTiles), 0, tiles);
  if (impacted === 0 || troops <= 0) return 0;
  if (tiles <= 5 || impacted >= tiles - 4) return troops;

  let survivalRatio = 1;
  for (let offset = 0; offset < 5; offset++) {
    survivalRatio *= (tiles - impacted - offset) / Math.max(1, tiles - offset);
  }
  return troops * (1 - clamp(survivalRatio, 0, 1));
}

export function countReadySiloSlots(
  silos: readonly { level: number; reloading: number }[],
): number {
  return silos.reduce(
    (sum, silo) =>
      sum + Math.max(0, Math.floor(silo.level) - Math.max(0, silo.reloading)),
    0,
  );
}

export function planStrategicCapability(
  context: StrategicCapabilityContext,
): StrategicCapabilityPlan {
  const threat = clamp(context.highestThreat, 0, 4);
  const targetPressure = Math.min(1, context.actionableTargets / 3);
  const enemySiloPressure = Math.min(1, context.enemySilos / 4);
  const opportunityValue =
    targetPressure * 8 + enemySiloPressure * 8 + threat * 3;
  const canFire =
    context.readyLaunchSlots > 0 &&
    context.affordableWeapons > 0 &&
    context.actionableTargets > 0;
  const desiredSilos = Math.min(
    3,
    Math.max(
      1,
      Math.ceil(enemySiloPressure + targetPressure + (threat >= 2 ? 1 : 0)),
    ),
  );
  const disposableGold = Math.max(0, context.gold - context.reserveGold);
  const shouldBuildSilo =
    context.ownSilos < desiredSilos &&
    context.actionableTargets > 0 &&
    context.siloCost > 0 &&
    disposableGold >= context.siloCost &&
    context.reserveRatio >= 0.68 &&
    context.incomingPressureRatio < 0.2 &&
    context.activeNationWars <= 1;

  return {
    canFire,
    shouldBuildSilo,
    desiredSilos,
    opportunityValue,
    reason: canFire
      ? `${context.readyLaunchSlots} loaded silo slot${context.readyLaunchSlots === 1 ? "" : "s"} can reach ${context.actionableTargets} strategic target${context.actionableTargets === 1 ? "" : "s"}`
      : shouldBuildSilo
        ? `build silo ${context.ownSilos + 1}/${desiredSilos} from disposable gold`
        : context.ownSilos === 0
          ? "no silo and current reserves do not support construction"
          : context.readyLaunchSlots === 0
            ? "all silo launch slots are reloading"
            : context.affordableWeapons === 0
              ? "no strategic weapon is affordable"
              : "no actionable strategic target",
  };
}

/**
 * Evaluates the exact engine-produced parabolic path. SAMs can only target the
 * portion within range of the source or destination; impassable terrain blocks
 * the entire trajectory, including its untargetable middle. Browser callers
 * use the persistent Rust spatial index once its Wasm module is ready; tests,
 * headless runs, and load failures retain this exact TypeScript fallback.
 */
export function assessStrategicRoute({
  path,
  source,
  destination,
  targetableRange,
  sams,
}: {
  path: readonly StrategicRoutePoint[];
  source: { x: number; y: number };
  destination: { x: number; y: number };
  targetableRange: number;
  sams: readonly StrategicRouteSam[];
}): StrategicRouteAssessment {
  const rust = assessStrategicRouteRust({
    path,
    source,
    destination,
    targetableRange,
    sams,
  });
  if (rust !== null) return rust;

  const rangeSquared = targetableRange ** 2;
  const intercepting = new Map<number, number>();
  const distanceSquared = (
    point: { x: number; y: number },
    other: { x: number; y: number },
  ) => (point.x - other.x) ** 2 + (point.y - other.y) ** 2;

  for (const point of path) {
    if (point.blocked) {
      return {
        blocked: true,
        interceptingSams: intercepting.size,
        interceptionCapacity: [...intercepting.values()].reduce(
          (sum, capacity) => sum + capacity,
          0,
        ),
      };
    }
    const targetable =
      distanceSquared(point, source) < rangeSquared ||
      distanceSquared(point, destination) < rangeSquared;
    if (!targetable) continue;
    for (const sam of sams) {
      if (
        sam.availableInterceptions > 0 &&
        distanceSquared(point, sam) <= sam.range ** 2
      ) {
        intercepting.set(sam.id, sam.availableInterceptions);
      }
    }
  }
  return {
    blocked: false,
    interceptingSams: intercepting.size,
    interceptionCapacity: [...intercepting.values()].reduce(
      (sum, capacity) => sum + capacity,
      0,
    ),
  };
}

export function assessStrategicStrike(
  context: StrategicStrikeContext,
): StrategicStrikeDecision {
  const reasons: string[] = [];

  if (context.availableWeapons <= 0) reasons.push("no weapon available");
  if (context.targetIsAlly) reasons.push("target is an ally");
  if (context.ticksSinceLastStrike < STRATEGIC_STRIKE_COOLDOWN_TICKS) {
    reasons.push("strategic strike cooldown is active");
  }
  const friendlyCollateral =
    (context.ownCollateralTiles ?? 0) > 0 ||
    (context.alliedCollateralTiles ?? 0) > 0 ||
    (context.ownUnitsAtRisk ?? 0) > 0 ||
    (context.alliedUnitsAtRisk ?? 0) > 0 ||
    context.wideAreaFriendlyBoundaryRisk === true;
  if (friendlyCollateral) {
    reasons.push(
      "the blast footprint reaches friendly territory or structures",
    );
  }
  const thirdPartyCollateral = (context.thirdPartyCollateralTiles ?? 0) > 0;
  if (thirdPartyCollateral) {
    reasons.push("the blast would create an unnecessary additional enemy");
  }
  if (context.pathBlocked)
    reasons.push("the launch path crosses impassable terrain");

  const expectedTroopLoss = context.expectedTroopLoss ?? context.targetTroops;
  const affectedTerritoryShare =
    context.affectedTargetTiles !== undefined &&
    context.targetTotalTiles !== undefined
      ? context.affectedTargetTiles / Math.max(1, context.targetTotalTiles)
      : context.targetTerritoryShare;
  const troopValue = Math.min(45, expectedTroopLoss / 20_000);
  const structureValue = Math.min(
    40,
    context.destroyedStructureValue ?? context.targetStructures * 5,
  );
  const territoryValue = Math.min(25, affectedTerritoryShare * 160);
  const distractionValue = Math.min(15, context.targetActiveWars * 5);
  const leaderValue = context.targetIsWinning ? 20 : 0;
  const requiredSalvoSize = Math.max(
    1,
    context.requiredSalvoSize ?? (context.samInterceptionCapacity ?? 0) + 1,
  );
  const samInterceptionCapacity = Math.max(
    0,
    context.samInterceptionCapacity ?? 0,
  );
  // The trainer emits one strategic launch intent at a time. Treating several
  // loaded silos as an instantaneous saturation salvo is therefore incorrect:
  // an upgraded SAM can consume each sequential missile before the next intent
  // is issued. Until real same-tick salvo launching is implemented, any loaded
  // interception slot on the evaluated trajectory makes the route unsafe.
  const samRouteUnsafe = samInterceptionCapacity > 0;
  const scarcityPenalty =
    context.availableWeapons === 1 && requiredSalvoSize === 1 ? 8 : 0;
  const samPenalty = samRouteUnsafe
    ? 45
    : context.targetHasSamCoverage
      ? context.weapon === "mirv"
        ? 16
        : 28
      : 0;
  const costPenalty =
    context.weaponCost !== undefined && context.weaponCost > 0
      ? Math.min(
          22,
          (context.weaponCost /
            Math.max(
              context.weaponCost,
              expectedTroopLoss +
                (context.destroyedStructureValue ?? 0) * 50_000,
            )) *
            22,
        )
      : 0;
  const exposurePenalty =
    context.ownReserveRatio < 0.4 || context.ownActiveNationWars >= 2 ? 18 : 0;

  const score =
    troopValue +
    structureValue +
    territoryValue +
    distractionValue +
    leaderValue -
    scarcityPenalty -
    samPenalty -
    costPenalty -
    exposurePenalty;

  if (context.targetHasSamCoverage) reasons.push("target has SAM coverage");
  if (samRouteUnsafe) {
    reasons.push(
      `launch path has ${samInterceptionCapacity} ready SAM interception slot${samInterceptionCapacity === 1 ? "" : "s"}; sequential launches cannot safely saturate it`,
    );
  }
  if (context.availableWeapons === 1)
    reasons.push("last weapon should be conserved");
  if (exposurePenalty > 0) reasons.push("own position is too exposed");
  if (score < 35) reasons.push("expected strike value is too low");

  return {
    fire:
      context.availableWeapons > 0 &&
      !context.targetIsAlly &&
      !friendlyCollateral &&
      !thirdPartyCollateral &&
      context.pathBlocked !== true &&
      !samRouteUnsafe &&
      context.ticksSinceLastStrike >= STRATEGIC_STRIKE_COOLDOWN_TICKS &&
      score >= 35,
    score,
    reasons,
  };
}

/**
 * Exact boundary-distance test used for wide-area MIRV safety. If hostile and
 * friendly territory boundaries come within a warhead radius, some dispersed
 * target tiles could create friendly collateral.
 */
export function boundariesWithinRadius({
  source,
  target,
  radius,
  position,
}: {
  source: Iterable<number>;
  target: Iterable<number>;
  radius: number;
  position: (tile: number) => { x: number; y: number };
}): boolean {
  const cellSize = Math.max(1, Math.ceil(radius));
  const buckets = new Map<string, Array<{ x: number; y: number }>>();
  for (const tile of source) {
    const point = position(tile);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [point]);
    else bucket.push(point);
  }
  const radiusSquared = radius * radius;
  for (const tile of target) {
    const point = position(tile);
    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (const other of buckets.get(
          `${cellX + offsetX}:${cellY + offsetY}`,
        ) ?? []) {
          if (
            (point.x - other.x) ** 2 + (point.y - other.y) ** 2 <=
            radiusSquared
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
