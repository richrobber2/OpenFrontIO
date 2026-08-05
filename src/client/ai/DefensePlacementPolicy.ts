import { UnitType } from "../../core/game/Game";

export const STRATEGIC_LAND_STRUCTURE_TYPES = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
] as const;

export function strategicStructureDefenseWeight(type: UnitType): number {
  switch (type) {
    case UnitType.Factory:
      return 6;
    case UnitType.City:
      return 5;
    case UnitType.MissileSilo:
      return 5;
    case UnitType.Port:
      return 4;
    case UnitType.SAMLauncher:
      return 3;
    default:
      return 0;
  }
}

/**
 * Prefer an incoming front that can capture valuable infrastructure soon,
 * while keeping troop count as the dominant signal.
 */
export function hostileFrontDefensePriority(context: {
  troops: number;
  defenseRadius: number;
  structures: ReadonlyArray<{ distance: number; type: UnitType }>;
}): number {
  const threatHorizon = Math.max(1, context.defenseRadius) * 10;
  const structureThreat = context.structures.reduce((sum, structure) => {
    const proximity = clamp(
      1 - Math.max(0, structure.distance) / threatHorizon,
      0,
      1,
    );
    return sum + strategicStructureDefenseWeight(structure.type) * proximity;
  }, 0);
  return (
    Math.max(0, context.troops) * (1 + Math.min(1.75, structureThreat * 0.12))
  );
}

/**
 * Value a post only when its real defense radius covers the structure tile.
 * Hostile proximity raises urgency, but central base buildings retain enough
 * value to establish a persistent inner defensive layer.
 */
export function strategicStructureProtectionValue(context: {
  candidateDistance: number;
  hostileDistance: number;
  defenseRadius: number;
  type: UnitType;
}): number {
  const defenseRadius = Math.max(1, context.defenseRadius);
  const candidateDistance = Math.max(0, context.candidateDistance);
  if (candidateDistance > defenseRadius) return 0;

  const coverage = 0.35 + 0.65 * (1 - candidateDistance / defenseRadius);
  const threatProximity = clamp(
    1 - Math.max(0, context.hostileDistance) / (defenseRadius * 10),
    0,
    1,
  );
  const urgency = 0.25 + threatProximity * 0.75;
  return strategicStructureDefenseWeight(context.type) * coverage * urgency;
}

export interface DefensePlacementContext {
  /** Total owned land that can benefit from defense-post slowdown. */
  totalOwnedLandTiles?: number;
  /** Owned land already inside any completed or planned defense radius. */
  alreadyCoveredOwnedLandTiles?: number;
  /** Owned land inside this candidate's radius. */
  candidateCoveredOwnedLandTiles?: number;
  /** Exact owned tiles covered by this candidate and no other defense. */
  candidateNewOwnedLandTiles?: number;

  /** Legacy frontier inputs, retained as conservative fallbacks for callers. */
  threatenedBorderTiles: number;
  alreadyCoveredThreatenedTiles: number;
  candidateCoveredThreatenedTiles: number;
  candidateNewThreatenedTiles?: number;

  /** Fraction of the candidate radius intersecting existing defense radii. */
  overlapWithExistingCoverage: number;
  distanceToNearestDefensePost: number;
  defenseRadius?: number;
  nearestDefenseRadius?: number;

  borderPressure: number;
  anticipatedBorderPressure?: number;
  estimatedEnemyArrivalTicks?: number;
  defensePostBuildTicks?: number;
  strategicChokepoint?: boolean;
  territoryValue: number;
  nearbyCriticalStructures: number;
  gold: number;
  defensePostCost: number;
  emergencyGoldFloor: number;
  activeNationWars: number;
}

export interface DefensePlacementDecision {
  build: boolean;
  score: number;
  newCoverageRatio: number;
  reason: string;
}

export interface ForwardDefenseBaitContext {
  ownTroops: number;
  maxTroops: number;
  enemyTroops: number;
  existingDefensePosts: number;
  fallbackDefensePosts: number;
  activeNationFronts: number;
  coveredBorderRatio: number;
  candidateDepth: number;
  defenseRadius: number;
  attackerAttritionMultiplier: number;
  captureResistanceMultiplier: number;
}

export interface ForwardDefenseBaitDecision {
  bait: boolean;
  score: number;
  projectedAttritionLeverage: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * A forward post can deliberately leave attractive border land in front of a
 * prepared fallback line. This is only worthwhile when the real engine
 * multipliers make the attack expensive and the existing network can survive
 * the post being focused or destroyed.
 */
export function evaluateForwardDefenseBait(
  context: ForwardDefenseBaitContext,
): ForwardDefenseBaitDecision {
  const reserveRatio =
    Math.max(0, context.ownTroops) / Math.max(1, context.maxTroops);
  const activeNationFronts = Math.max(
    1,
    Math.floor(context.activeNationFronts),
  );
  const requiredDefensePosts = Math.max(2, activeNationFronts + 1);
  const attritionMultiplier = Math.max(1, context.attackerAttritionMultiplier);
  const captureResistanceMultiplier = Math.max(
    1,
    context.captureResistanceMultiplier,
  );
  const projectedAttritionLeverage =
    (Math.max(0, context.ownTroops) / Math.max(1, context.enemyTroops)) *
    attritionMultiplier;
  const defenseRadius = Math.max(1, context.defenseRadius);
  const candidateDepth = Math.max(0, context.candidateDepth);
  const coveredBorderRatio = clamp(context.coveredBorderRatio, 0, 1);

  const reject = (reason: string): ForwardDefenseBaitDecision => ({
    bait: false,
    score: -20,
    projectedAttritionLeverage,
    reason,
  });

  if (
    context.existingDefensePosts < requiredDefensePosts ||
    context.fallbackDefensePosts < 1
  ) {
    return reject(
      "the existing network does not provide a surviving fallback defense",
    );
  }
  if (reserveRatio < 0.68) {
    return reject("the home reserve is too low to invite a nation attack");
  }
  if (coveredBorderRatio < 0.15) {
    return reject("too little of the current border has fallback coverage");
  }
  if (
    candidateDepth < defenseRadius * 0.25 ||
    candidateDepth > defenseRadius * 0.9
  ) {
    return reject(
      "the candidate is either immediately capturable or too deep to tax the border",
    );
  }
  if (attritionMultiplier < 4 || captureResistanceMultiplier < 2) {
    return reject(
      "the measured combat multipliers are too weak for a deliberate bait",
    );
  }
  if (projectedAttritionLeverage < 2.4) {
    return reject(
      "the enemy force is too large for the measured attrition advantage",
    );
  }

  const idealDepth = defenseRadius * 0.45;
  const depthQuality = clamp(
    1 - Math.abs(candidateDepth - idealDepth) / idealDepth,
    0,
    1,
  );
  const networkSurplus = clamp(
    (context.existingDefensePosts - requiredDefensePosts) /
      requiredDefensePosts,
    0,
    1,
  );
  const score =
    30 +
    attritionMultiplier * 6 +
    captureResistanceMultiplier * 5 +
    Math.min(5, projectedAttritionLeverage) * 4 +
    reserveRatio * 10 +
    coveredBorderRatio * 15 +
    depthQuality * 12 +
    networkSurplus * 8 +
    Math.min(2, context.fallbackDefensePosts) * 4;

  return {
    bait: true,
    score,
    projectedAttritionLeverage,
    reason:
      "a completed fallback network can turn attractive border land into measured attacker attrition",
  };
}

/**
 * Defense posts do not stack. Placement therefore solves a land-coverage
 * problem: maximize unique owned tiles per post and reject intersecting radii.
 * Border pressure affects urgency, but never defines the coverage objective.
 */
export function evaluateDefensePlacement(
  context: DefensePlacementContext,
): DefensePlacementDecision {
  const totalLand = Math.max(
    0,
    context.totalOwnedLandTiles ?? context.threatenedBorderTiles,
  );
  if (totalLand <= 0) {
    return {
      build: false,
      score: -20,
      newCoverageRatio: 0,
      reason: "there is no owned land worth covering",
    };
  }

  const affordableGold = context.gold - context.emergencyGoldFloor;
  if (affordableGold < context.defensePostCost) {
    return {
      build: false,
      score: -20,
      newCoverageRatio: 0,
      reason: "building would consume the emergency gold reserve",
    };
  }

  const coveredLand = clamp(
    context.alreadyCoveredOwnedLandTiles ??
      context.alreadyCoveredThreatenedTiles,
    0,
    totalLand,
  );
  const candidateCoveredLand = clamp(
    context.candidateCoveredOwnedLandTiles ??
      context.candidateCoveredThreatenedTiles,
    0,
    totalLand,
  );
  const uncoveredLand = Math.max(0, totalLand - coveredLand);
  const overlapRatio = clamp(context.overlapWithExistingCoverage, 0, 1);
  const estimatedNewLand = candidateCoveredLand * (1 - overlapRatio);
  const candidateNewLand = clamp(
    context.candidateNewOwnedLandTiles ??
      context.candidateNewThreatenedTiles ??
      estimatedNewLand,
    0,
    Math.min(candidateCoveredLand, uncoveredLand),
  );

  const newCoverageRatio = candidateNewLand / totalLand;
  const candidateEfficiency =
    candidateCoveredLand > 0 ? candidateNewLand / candidateCoveredLand : 0;
  const existingCoverageRatio = coveredLand / totalLand;
  const remainingCoverageRatio =
    uncoveredLand > 0 ? candidateNewLand / uncoveredLand : 0;

  const candidateRadius = Math.max(0, context.defenseRadius ?? 0);
  const nearestRadius = Math.max(
    0,
    context.nearestDefenseRadius ?? candidateRadius,
  );
  const nonOverlapDistance = candidateRadius + nearestRadius;

  // Non-stacking effects make any radius intersection pure waste. Use geometry
  // when radii are known and an almost-zero tolerance for tile-set overlap.
  if (
    (nonOverlapDistance > 0 &&
      context.distanceToNearestDefensePost < nonOverlapDistance) ||
    overlapRatio > 0.02
  ) {
    return {
      build: false,
      score: -40,
      newCoverageRatio,
      reason:
        "the candidate defense radius overlaps an existing defense radius",
    };
  }

  if (candidateEfficiency < 0.85) {
    return {
      build: false,
      score: -30,
      newCoverageRatio,
      reason:
        "too much of the candidate radius fails to add unique owned-land coverage",
    };
  }

  if (existingCoverageRatio >= 0.9) {
    return {
      build: false,
      score: -15,
      newCoverageRatio,
      reason: "owned land is already sufficiently covered",
    };
  }

  const minimumNewTiles = Math.max(8, Math.ceil(totalLand * 0.03));
  if (candidateNewLand < minimumNewTiles || newCoverageRatio < 0.03) {
    return {
      build: false,
      score: -10,
      newCoverageRatio,
      reason: "the candidate adds too little unique owned-land coverage",
    };
  }

  const currentPressure = Math.max(0, context.borderPressure);
  const anticipatedPressure = Math.max(
    0,
    context.anticipatedBorderPressure ?? 0,
  );
  const effectivePressure = Math.max(
    currentPressure,
    anticipatedPressure * 0.85,
  );
  const buildTicks = Math.max(0, context.defensePostBuildTicks ?? 0);
  const arrivalTicks = context.estimatedEnemyArrivalTicks;

  if (
    arrivalTicks !== undefined &&
    arrivalTicks >= 0 &&
    buildTicks > 0 &&
    buildTicks + 20 > arrivalTicks &&
    effectivePressure > 0.5
  ) {
    return {
      build: false,
      score: -25,
      newCoverageRatio,
      reason:
        "the defense post would finish too late to affect the expected attack",
    };
  }

  const coverageValue = newCoverageRatio * 110;
  const efficiencyValue = candidateEfficiency * 32;
  const closureValue = remainingCoverageRatio * 20;
  const landValue = clamp(context.territoryValue, 0, 1.5) * 14;
  const structureValue = Math.min(3, context.nearbyCriticalStructures) * 5;
  const pressureValue = clamp(effectivePressure, 0, 1.5) * 8;
  const chokepointValue = context.strategicChokepoint ? 8 : 0;
  const warValue = Math.min(3, context.activeNationWars) * 2;
  const earlyBuildValue =
    arrivalTicks !== undefined && buildTicks > 0
      ? clamp((arrivalTicks - buildTicks) / 100, 0, 1) * 6
      : 0;

  const score =
    coverageValue +
    efficiencyValue +
    closureValue +
    landValue +
    structureValue +
    pressureValue +
    chokepointValue +
    warValue +
    earlyBuildValue;

  if (score < 34) {
    return {
      build: false,
      score,
      newCoverageRatio,
      reason: "the unique owned-land coverage is not valuable enough",
    };
  }

  return {
    build: true,
    score,
    newCoverageRatio,
    reason:
      "the post maximizes unique owned-land coverage without overlapping another radius",
  };
}
