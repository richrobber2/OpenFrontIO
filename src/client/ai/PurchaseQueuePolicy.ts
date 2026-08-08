import {
  preloadRustPurchaseQueueAi,
  selectPurchaseQueueRust,
} from "../rust/OpenFrontWasmPurchaseQueueAi";

void preloadRustPurchaseQueueAi();

export interface PurchaseQueueCandidate {
  index: number;
  group?: number;
  cost: number;
  value: number;
  returnRatio: number;
  synergy: number;
}

export interface PurchaseQueueContext {
  spendCap: number;
  minimumPurchases: number;
  maximumPurchases: number;
  risk: number;
  capitalPressure: number;
  candidates: readonly PurchaseQueueCandidate[];
}

export interface PurchaseQueuePlan {
  selectedIndices: number[];
  totalCost: number;
  totalScore: number;
  remainingBudget: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const normalize = (value: number, minimum: number, maximum: number): number =>
  maximum <= minimum ? 1 : clamp((value - minimum) / (maximum - minimum), 0, 1);

export function selectPurchaseQueue(
  context: PurchaseQueueContext,
): PurchaseQueuePlan {
  const rust = selectPurchaseQueueRust(context);
  if (rust !== null) return rust;

  const spendCap = Math.max(0, context.spendCap);
  if (spendCap <= 0 || context.maximumPurchases <= 0 || context.candidates.length === 0) {
    return {
      selectedIndices: [],
      totalCost: 0,
      totalScore: 0,
      remainingBudget: spendCap,
    };
  }

  const risk = clamp(context.risk, 0, 1);
  const capitalPressure = clamp(context.capitalPressure, 0, 1);
  const valid = context.candidates.filter(
    (candidate) =>
      Number.isFinite(candidate.cost) &&
      candidate.cost > 0 &&
      Number.isFinite(candidate.value) &&
      Number.isFinite(candidate.returnRatio) &&
      Number.isFinite(candidate.synergy) &&
      candidate.cost <= spendCap,
  );
  if (valid.length === 0) {
    return {
      selectedIndices: [],
      totalCost: 0,
      totalScore: 0,
      remainingBudget: spendCap,
    };
  }

  const minimumValue = Math.min(...valid.map((candidate) => candidate.value));
  const maximumValue = Math.max(...valid.map((candidate) => candidate.value));
  const requestedMaximum = Math.max(0, Math.floor(context.maximumPurchases));
  const riskLimitedMaximum =
    risk >= 0.8
      ? 1
      : risk >= 0.6
        ? Math.min(requestedMaximum, 2)
        : risk >= 0.4
          ? Math.min(requestedMaximum, 4)
          : requestedMaximum;
  const baselineTarget = Math.min(
    riskLimitedMaximum,
    Math.max(1, Math.floor(context.minimumPurchases)),
  );
  const target =
    capitalPressure >= 0.85
      ? riskLimitedMaximum
      : capitalPressure >= 0.65
        ? Math.min(riskLimitedMaximum, baselineTarget + 2)
        : capitalPressure >= 0.45
          ? Math.min(riskLimitedMaximum, baselineTarget + 1)
          : baselineTarget;

  const ranked = valid
    .map((candidate) => {
      const quality = normalize(candidate.value, minimumValue, maximumValue);
      const returnQuality = clamp(candidate.returnRatio / 0.75, 0, 1);
      const synergy = clamp(candidate.synergy, 0, 1);
      const costShare = clamp(candidate.cost / Math.max(1, spendCap), 0, 1);
      const capitalEfficiency = 1 - costShare;
      const score =
        quality * 0.48 +
        returnQuality * 0.24 +
        synergy * 0.14 +
        capitalEfficiency * 0.08 +
        capitalPressure * 0.06 -
        risk * costShare * 0.22;
      return { candidate, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.candidate.returnRatio - a.candidate.returnRatio ||
        a.candidate.cost - b.candidate.cost ||
        a.candidate.index - b.candidate.index,
    );

  const selectedIndices: number[] = [];
  const usedGroups = new Set<number>();
  let totalCost = 0;
  let totalScore = 0;
  for (const { candidate, score } of ranked) {
    if (selectedIndices.length >= target) break;
    const group = Math.max(0, Math.floor(candidate.group ?? 0));
    if (group !== 0 && usedGroups.has(group)) continue;
    if (totalCost + candidate.cost > spendCap + Number.EPSILON) continue;
    totalCost += candidate.cost;
    totalScore += score;
    selectedIndices.push(candidate.index);
    if (group !== 0) usedGroups.add(group);
  }

  return {
    selectedIndices,
    totalCost,
    totalScore,
    remainingBudget: Math.max(0, spendCap - totalCost),
  };
}
