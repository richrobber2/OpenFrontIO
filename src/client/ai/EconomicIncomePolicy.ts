export interface RecurringIncomeUpdate {
  estimate: number;
  acceptedRate: number;
  windfallRatio: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

/**
 * Uses the recent median as a recurring-income baseline. Large positive jumps
 * are retained as gold by the game but only their plausible recurring portion
 * enters the budget model, preventing conquest rewards from inflating reserves.
 */
export function updateRecurringIncomeEstimate({
  currentEstimate,
  observedRate,
  recentAcceptedRates,
}: {
  currentEstimate: number;
  observedRate: number;
  recentAcceptedRates: number[];
}): RecurringIncomeUpdate {
  const safeObserved = Math.max(0, observedRate);
  const baseline =
    median(recentAcceptedRates.filter((rate) => rate > 0)) ||
    Math.max(0, currentEstimate) ||
    safeObserved;
  const sampleConfidence = Math.min(1, recentAcceptedRates.length / 8);
  const maximumGrowthRatio = 2.5 - sampleConfidence;
  const acceptedRate =
    baseline <= 0
      ? safeObserved
      : Math.min(safeObserved, baseline * maximumGrowthRatio);
  const windfallRatio =
    safeObserved <= 0
      ? 0
      : Math.max(0, 1 - acceptedRate / Math.max(1, safeObserved));
  const relativeDeviation =
    baseline <= 0 ? 0 : Math.abs(acceptedRate - baseline) / baseline;
  const observationWeight = 0.08 + 0.12 / (1 + Math.max(0, relativeDeviation));
  const estimate =
    currentEstimate <= 0
      ? acceptedRate
      : Math.max(
          0,
          currentEstimate * (1 - observationWeight) +
            acceptedRate * observationWeight,
        );

  return { estimate, acceptedRate, windfallRatio };
}
