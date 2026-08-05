import { OpponentChoice } from "./OpponentForecastPolicy";

export type RemnantConquestPlan = {
  shouldAttack: boolean;
  isRemnant: boolean;
  negligibleNewFront: boolean;
  commitFraction: number;
  projectedReserveRatio: number;
  bountyGold: number;
  score: number;
  reason: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function planRemnantConquest({
  ownTroops,
  ownMaxTroops,
  ownTiles,
  reserveFloor,
  targetTroops,
  targetFieldTroops = 0,
  targetMaxTroops,
  targetTiles,
  targetGold,
  capturesFullGold,
  targetIsTribe,
  targetIsAllied,
  sharesBorder,
  activeNationWars,
  maximumNationWars,
  incomingFronts,
  alreadyFightingTarget,
  terrainLossCost,
  wrapPotential,
  estimatedConquestTicks,
  predictedChoice,
}: {
  ownTroops: number;
  ownMaxTroops: number;
  ownTiles: number;
  reserveFloor: number;
  targetTroops: number;
  targetFieldTroops?: number;
  targetMaxTroops: number;
  targetTiles: number;
  targetGold: number;
  capturesFullGold: boolean;
  targetIsTribe: boolean;
  targetIsAllied: boolean;
  sharesBorder: boolean;
  activeNationWars: number;
  maximumNationWars: number;
  incomingFronts: number;
  alreadyFightingTarget: boolean;
  terrainLossCost: number;
  wrapPotential: number;
  estimatedConquestTicks: number;
  predictedChoice?: OpponentChoice;
}): RemnantConquestPlan {
  const totalTargetForce = targetTroops + targetFieldTroops;
  const forceRatio = totalTargetForce / Math.max(1, ownTroops);
  const capacityRatio = targetMaxTroops / Math.max(1, ownMaxTroops);
  const territoryRatio = targetTiles / Math.max(1, ownTiles);
  const targetReserveRatio = targetTroops / Math.max(1, targetMaxTroops);
  const isRemnant =
    (targetReserveRatio <= 0.22 &&
      capacityRatio <= 0.55 &&
      forceRatio <= 0.34) ||
    (territoryRatio <= 0.1 && forceRatio <= 0.25) ||
    (targetTiles <= 240 && forceRatio <= 0.16);
  const negligibleNewFront =
    forceRatio <= 0.08 && capacityRatio <= 0.14 && territoryRatio <= 0.06;
  const dynamicReserveFloor = clamp(
    Math.max(reserveFloor, 0.38 + Math.min(0.08, activeNationWars * 0.02)),
    0.38,
    0.58,
  );
  const spendableTroops = Math.max(
    0,
    ownTroops - ownMaxTroops * dynamicReserveFloor,
  );
  const defenseFactor =
    predictedChoice === "defend" || predictedChoice === "bank" ? 1.12 : 1;
  const surroundDiscount = 1 - clamp(wrapPotential, 0, 1) * 0.3;
  const requiredTroops = Math.max(
    ownTroops * 0.1,
    targetTroops *
      Math.max(0.75, terrainLossCost) *
      defenseFactor *
      surroundDiscount *
      (targetIsTribe ? 1.08 : 1.22),
  );
  const commitFraction = clamp(
    requiredTroops / Math.max(1, ownTroops),
    0.1,
    Math.max(0.1, spendableTroops / Math.max(1, ownTroops)),
  );
  const projectedReserveRatio =
    (ownTroops * (1 - commitFraction)) / Math.max(1, ownMaxTroops);
  const bountyGold = capturesFullGold ? targetGold : targetGold / 2;
  const bountyValue =
    Math.log10(Math.max(1, bountyGold) + 1) * (capturesFullGold ? 1.15 : 0.8);
  const closureValue =
    (targetIsTribe ? 3 : 2) +
    Math.min(4, targetTiles / Math.max(40, ownTiles * 0.02));
  const timeCost = estimatedConquestTicks / 120;
  const frontCost =
    alreadyFightingTarget || targetIsTribe || negligibleNewFront ? 0 : 2.5;
  const score =
    bountyValue +
    closureValue +
    wrapPotential * 2 -
    forceRatio * 8 -
    timeCost -
    frontCost;

  const blockedReason = !sharesBorder
    ? "the remnant has no legal shared land border"
    : targetIsAllied
      ? "the alliance must expire or be deliberately broken before conquest"
      : !isRemnant
        ? "the target is still large enough to create a durable war"
        : incomingFronts > 0
          ? "an active invasion makes bounty cleanup unsafe"
          : activeNationWars >= maximumNationWars &&
              !alreadyFightingTarget &&
              !targetIsTribe &&
              !negligibleNewFront
            ? "the target would exceed the safe hostile-front budget"
            : requiredTroops > spendableTroops
              ? "finishing it would break the live home-reserve floor"
              : estimatedConquestTicks > (targetIsTribe ? 600 : 480)
                ? "the remaining territory is too slow to finish now"
                : score <= 0
                  ? "the elimination bounty does not repay the force and time cost"
                  : undefined;

  return {
    shouldAttack: blockedReason === undefined,
    isRemnant,
    negligibleNewFront,
    commitFraction,
    projectedReserveRatio,
    bountyGold,
    score,
    reason:
      blockedReason ??
      `full elimination releases ${Math.round(bountyGold).toLocaleString()} gold and closes a ${targetTiles.toLocaleString()}-tile remnant in about ${Math.round(estimatedConquestTicks)} ticks`,
  };
}
