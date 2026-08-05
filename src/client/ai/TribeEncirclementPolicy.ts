export interface TribeEncirclementContext {
  tribeID: string;
  tribeTiles: number;
  tribeTroops: number;
  perimeterTiles: number;
  ownedPerimeterTiles: number;
  neutralPerimeterTiles: number;
  enemyPerimeterTiles: number;
  ringCompletionTroopCost: number;
  directAssaultTroopCost: number;
  availableTroops: number;
  reserveTroops: number;
  competingNationDistance: number;
  estimatedRingCompletionTicks: number;
  estimatedCompetitorArrivalTicks: number;
  captureTriggersOnFullEncirclement: boolean;
}

export interface TribeEncirclementDecision {
  action: "hold" | "complete-ring" | "direct-assault";
  tribeID?: string;
  maxTroops: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Prefers surrounding a tribe when full encirclement grants the territory without
 * paying the tribe's direct combat cost. The policy abandons the maneuver when a
 * nearby nation is likely to steal the capture or when closing the ring is more
 * expensive than simply attacking.
 */
export function chooseTribeCapture(
  context: TribeEncirclementContext,
): TribeEncirclementDecision {
  const spendableTroops = Math.max(0, context.availableTroops - context.reserveTroops);
  if (spendableTroops <= 0 || context.tribeTiles <= 0) {
    return {
      action: "hold",
      maxTroops: 0,
      reason: "no safe troop budget is available for tribe expansion",
    };
  }

  const perimeter = Math.max(1, context.perimeterTiles);
  const controlledPerimeter = clamp(context.ownedPerimeterTiles, 0, perimeter);
  const ringProgress = controlledPerimeter / perimeter;
  const openPerimeter = Math.max(
    0,
    perimeter - controlledPerimeter - Math.max(0, context.enemyPerimeterTiles),
  );

  const competitorCanSteal =
    context.competingNationDistance <= 12 &&
    context.estimatedCompetitorArrivalTicks <=
      context.estimatedRingCompletionTicks + 20;

  const ringIsCheaper =
    context.ringCompletionTroopCost <= context.directAssaultTroopCost * 0.45;
  const ringIsAffordable = context.ringCompletionTroopCost <= spendableTroops;
  const directIsAffordable = context.directAssaultTroopCost <= spendableTroops;

  if (
    context.captureTriggersOnFullEncirclement &&
    !competitorCanSteal &&
    openPerimeter > 0 &&
    ringIsCheaper &&
    ringIsAffordable &&
    (ringProgress >= 0.35 || context.neutralPerimeterTiles > 0)
  ) {
    return {
      action: "complete-ring",
      tribeID: context.tribeID,
      maxTroops: Math.ceil(context.ringCompletionTroopCost),
      reason: "complete the enclosure and capture the tribe without paying its combat cost",
    };
  }

  if (directIsAffordable && !competitorCanSteal) {
    return {
      action: "direct-assault",
      tribeID: context.tribeID,
      maxTroops: Math.ceil(
        Math.min(spendableTroops, context.directAssaultTroopCost * 1.08),
      ),
      reason: "direct assault is safer or cheaper than completing the enclosure",
    };
  }

  return {
    action: "hold",
    maxTroops: 0,
    reason: competitorCanSteal
      ? "another nation could steal the encircled tribe before capture completes"
      : "neither capture method fits the available troop budget",
  };
}
