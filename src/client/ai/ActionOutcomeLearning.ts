import { PredictionAction } from "./StrategyMath";

export type ActionOutcomeGenes = {
  aggression: number;
  caution: number;
  naval: number;
};

export type ActionRewardBaseline = { mean: number; samples: number };

export type NormalizedActionReward = {
  learningSignal: number;
  baseline: ActionRewardBaseline;
};

export type ActionOutcome = {
  action: PredictionAction;
  startingTroops: number;
  endingTroops: number;
  maxTroops: number;
  startingTiles: number;
  endingTiles: number;
  startingGold: number;
  endingGold: number;
  survived: boolean;
};

export type CounterfactualActionOutcome = ActionOutcome & {
  expectedTroops: number;
  expectedTiles: number;
};

const clampGene = (value: number) => Math.max(-1, Math.min(1, value));

export function normalizeActionReward(
  reward: number,
  baseline: ActionRewardBaseline,
): NormalizedActionReward {
  const boundedReward = Math.max(-1, Math.min(1, reward));
  const learningSignal =
    baseline.samples === 0 ? boundedReward : boundedReward - baseline.mean;
  const samples = Math.min(10_000, baseline.samples + 1);
  const window = Math.min(64, samples);
  return {
    learningSignal: Math.abs(learningSignal) < 0.01 ? 0 : learningSignal,
    baseline: {
      mean: baseline.mean + (boundedReward - baseline.mean) / window,
      samples,
    },
  };
}

export function scoreDelayedActionOutcome(outcome: ActionOutcome): number {
  if (!outcome.survived) return -1;
  const reserveDelta =
    (outcome.endingTroops - outcome.startingTroops) /
    Math.max(1, outcome.maxTroops);
  const landDelta =
    (outcome.endingTiles - outcome.startingTiles) /
    Math.max(25, outcome.startingTiles);
  const goldDelta =
    (outcome.endingGold - outcome.startingGold) /
    Math.max(25_000, Math.abs(outcome.startingGold));
  const actionLandWeight =
    outcome.action === "attack" || outcome.action === "expand" ? 0.65 : 0.25;
  const actionReserveWeight =
    outcome.action === "defend" || outcome.action === "hold" ? 0.65 : 0.3;
  return Math.max(
    -1,
    Math.min(
      1,
      landDelta * actionLandWeight +
        reserveDelta * actionReserveWeight +
        goldDelta * 0.15,
    ),
  );
}

export function scoreCounterfactualActionOutcome(
  outcome: CounterfactualActionOutcome,
): number {
  if (!outcome.survived) return -1;
  const troopAdvantage =
    (outcome.endingTroops - outcome.expectedTroops) /
    Math.max(1, outcome.maxTroops);
  const tileAdvantage =
    (outcome.endingTiles - outcome.expectedTiles) /
    Math.max(25, outcome.startingTiles);
  const landWeight =
    outcome.action === "attack" || outcome.action === "expand" ? 0.7 : 0.3;
  const troopWeight = 1 - landWeight;
  return Math.max(
    -1,
    Math.min(1, tileAdvantage * landWeight + troopAdvantage * troopWeight),
  );
}

export function applyActionOutcomeLearning(
  genes: ActionOutcomeGenes,
  action: PredictionAction,
  reward: number,
  priorSamples: number,
  attributionWeight = 1,
): ActionOutcomeGenes {
  const boundedAttribution = Math.max(0.1, Math.min(1, attributionWeight));
  const regularization = 0.002 * boundedAttribution;
  const step =
    (0.08 / Math.sqrt(Math.max(1, priorSamples + 1))) *
    reward *
    boundedAttribution;
  const next = { ...genes };
  if (action === "attack" || action === "expand") {
    next.aggression = clampGene(
      next.aggression + step - next.aggression * regularization,
    );
  } else if (action === "fleet") {
    next.naval = clampGene(next.naval + step - next.naval * regularization);
  } else {
    next.caution = clampGene(
      next.caution + step - next.caution * regularization,
    );
  }
  return next;
}
