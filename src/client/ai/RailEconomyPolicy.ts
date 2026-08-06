export interface RailEconomyCandidate {
  id: string;
  distanceToFactoryA: number;
  distanceToFactoryB: number;
  isOnRailTrack: boolean;
  projectedGoldPerMinute: number;
  buildCost: number;
  overlapWithExistingCityCoverage: number;
  threatenedBorderPressure: number;
}

export interface RailEconomyContext {
  hasFactoryPair: boolean;
  factoryConnectionValue: number;
  gold: number;
  emergencyGoldFloor: number;
  minimumPaybackMinutes: number;
  candidates: RailEconomyCandidate[];
}

export interface RailEconomyDecision {
  action: "hold" | "connect-factories" | "build-city";
  candidateID?: string;
  score: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Builds factory-to-factory rail corridors first, then places cities on the
 * actual track tiles between the factories. Nearby land does not qualify.
 */
export function chooseRailEconomyPlan(
  context: RailEconomyContext,
): RailEconomyDecision {
  const spendableGold = Math.max(0, context.gold - context.emergencyGoldFloor);

  if (!context.hasFactoryPair) {
    if (spendableGold <= 0 || context.factoryConnectionValue < 0.55) {
      return {
        action: "hold",
        score: context.factoryConnectionValue,
        reason: "no affordable factory corridor has enough economic value",
      };
    }

    return {
      action: "connect-factories",
      score: context.factoryConnectionValue,
      reason: "connect high-value factories before placing track cities",
    };
  }

  const ranked = context.candidates
    .filter((candidate) => candidate.isOnRailTrack)
    .map((candidate) => {
      const endpointBalance =
        1 -
        clamp(
          Math.abs(candidate.distanceToFactoryA - candidate.distanceToFactoryB) /
            Math.max(1, candidate.distanceToFactoryA + candidate.distanceToFactoryB),
          0,
          1,
        );
      const overlapPenalty =
        clamp(candidate.overlapWithExistingCityCoverage, 0, 1) * 45;
      const riskPenalty = clamp(candidate.threatenedBorderPressure, 0, 1) * 30;
      const paybackMinutes =
        candidate.projectedGoldPerMinute > 0
          ? candidate.buildCost / candidate.projectedGoldPerMinute
          : Number.POSITIVE_INFINITY;
      const paybackValue =
        paybackMinutes <= context.minimumPaybackMinutes
          ? (context.minimumPaybackMinutes - paybackMinutes) * 4
          : -(paybackMinutes - context.minimumPaybackMinutes) * 8;
      const score =
        50 +
        endpointBalance * 14 +
        candidate.projectedGoldPerMinute / 5 +
        paybackValue -
        overlapPenalty -
        riskPenalty;

      return { candidate, score, paybackMinutes };
    })
    .filter(({ candidate }) => candidate.buildCost <= spendableGold)
    .filter(({ candidate }) => candidate.overlapWithExistingCityCoverage <= 0.25)
    .filter(({ paybackMinutes }) => paybackMinutes <= context.minimumPaybackMinutes)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (best === undefined || best.score < 20) {
    return {
      action: "hold",
      score: best?.score ?? 0,
      reason: "no on-track city repays its cost without excessive overlap or risk",
    };
  }

  return {
    action: "build-city",
    candidateID: best.candidate.id,
    score: best.score,
    reason: "place the city directly on the factory rail track",
  };
}
