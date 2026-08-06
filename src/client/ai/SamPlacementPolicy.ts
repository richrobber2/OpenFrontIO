import { UnitType } from "../../core/game/Game";

export interface SamProtectedStructure {
  type: UnitType;
  existingCoverage: number;
}

export const MIRV_SAM_PROTECTION_RADIUS = 49;

export function samPlacementProtectionRadius(
  mirvThreat: boolean,
  conventionalRange: number,
): number {
  return mirvThreat
    ? Math.min(Math.max(1, conventionalRange), MIRV_SAM_PROTECTION_RADIUS)
    : Math.max(1, conventionalRange);
}

export function samStructureValue(type: UnitType): number {
  switch (type) {
    case UnitType.MissileSilo:
      return 10;
    case UnitType.Factory:
      return 7;
    case UnitType.City:
      return 6;
    case UnitType.Port:
      return 5;
    case UnitType.SAMLauncher:
      return 2;
    default:
      return 3;
  }
}

export function scoreSamPlacement(context: {
  protectedStructures: readonly SamProtectedStructure[];
  depth: number;
  isShore: boolean;
  nearestSamDistance: number;
  samRange: number;
}): { score: number; newlyCovered: number; layered: number } {
  let newlyCovered = 0;
  let layered = 0;
  let protection = 0;
  for (const structure of context.protectedStructures) {
    const value = samStructureValue(structure.type);
    if (structure.existingCoverage === 0) {
      newlyCovered++;
      protection += value;
    } else {
      layered++;
      protection += value * (structure.existingCoverage === 1 ? 0.5 : 0.12);
    }
  }
  const range = Math.max(1, context.samRange);
  const spacingRatio = Math.max(0, context.nearestSamDistance) / range;
  const stackingPenalty = spacingRatio < 0.3 ? (0.3 - spacingRatio) * 35 : 0;
  const depthValue = Math.min(Math.max(0, context.depth), range) * 0.35;
  return {
    score:
      protection + depthValue - stackingPenalty - (context.isShore ? 8 : 0),
    newlyCovered,
    layered,
  };
}
