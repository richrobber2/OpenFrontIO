export interface FortifiedTargetContext {
  troopAdvantage: number;
  terrainDefenseMultiplier: number;
  defensePostCoverage: number;
  estimatedTicks: number;
  coastalStructureValue: number;
  inlandStructureValue: number;
  borderWidth: number;
  alternateTargets: number;
}

export interface FortifiedTargetDecision {
  attack: boolean;
  preferCoastalRaid: boolean;
  requiredAdvantage: number;
  score: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Avoids grinding through defense-post zones when cheaper structure theft or
 * another front exists. Defense-post coverage is expressed from 0 to 1.
 */
export function evaluateFortifiedTarget(
  context: FortifiedTargetContext,
): FortifiedTargetDecision {
  const coverage = clamp(context.defensePostCoverage, 0, 1);
  const defensePostMultiplier = 1 + coverage * 4;
  const requiredAdvantage =
    1.25 *
    Math.max(0.8, context.terrainDefenseMultiplier) *
    defensePostMultiplier;

  const strategicValue =
    context.inlandStructureValue * 0.7 + context.coastalStructureValue;
  const durationPenalty = Math.max(0, context.estimatedTicks - 180) / 18;
  const narrowFrontPenalty = Math.max(0, 5 - context.borderWidth) * 2;
  const alternativePenalty = context.alternateTargets > 0 ? 10 : 0;
  const score =
    strategicValue +
    (context.troopAdvantage - requiredAdvantage) * 30 -
    durationPenalty -
    narrowFrontPenalty -
    alternativePenalty;

  const preferCoastalRaid =
    context.coastalStructureValue >= 8 &&
    (coverage >= 0.35 || context.troopAdvantage < requiredAdvantage);

  if (preferCoastalRaid) {
    return {
      attack: false,
      preferCoastalRaid: true,
      requiredAdvantage,
      score,
      reason:
        "steal exposed coastal structures instead of grinding through the fortified interior",
    };
  }

  if (
    context.troopAdvantage < requiredAdvantage ||
    context.estimatedTicks > 600 ||
    score <= 0
  ) {
    return {
      attack: false,
      preferCoastalRaid: false,
      requiredAdvantage,
      score,
      reason:
        "fortification, terrain, duration, or alternatives make this attack inefficient",
    };
  }

  return {
    attack: true,
    preferCoastalRaid: false,
    requiredAdvantage,
    score,
    reason: "the target has enough strategic value to justify the fortified front",
  };
}
