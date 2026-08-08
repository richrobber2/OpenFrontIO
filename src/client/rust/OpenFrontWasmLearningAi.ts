import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export type RustPredictionAction =
  | "hold"
  | "attack"
  | "expand"
  | "defend"
  | "fleet";

const ACTION_CODES: Record<RustPredictionAction, number> = {
  hold: 0,
  attack: 1,
  expand: 2,
  defend: 3,
  fleet: 4,
};

export interface RustFuturePredictionInput {
  action: RustPredictionAction;
  troops: number;
  maxTroops: number;
  tiles: number;
  enemyTroops: number;
  horizon: number;
  sample: number;
}

export interface RustFuturePredictionResult {
  expectedTroops: number;
  expectedTiles: number;
  confidence: number;
  expectedMaxTroops: number;
  capacityGain: number;
}

export interface RustMutationOutcomeInput {
  won: boolean;
  alive: boolean;
  playerCount: number;
  finishingRank: number;
  raidSuccessRate: number;
  retaliationRate: number;
  transportLossRate: number;
  predictionQuality: number;
  startingTiles: number;
  peakTiles: number;
  totalLandTiles: number;
  elapsedTicks: number;
  noGrowthTicks: number;
  longestNoGrowthTicks: number;
  peakCities: number;
  peakFactories: number;
}

export interface RustLossCauseInput {
  elapsedTicks: number;
  thirdPartyPressureTicks: number;
  maxIncomingRatio: number;
  lowReserveTicks: number;
  maxCommittedRatio: number;
  longestStallTicks: number;
  longestNoGrowthTicks: number;
  noGainTicks: number;
  peakTiles: number;
  peakCities: number;
}

export interface RustSeedCohortInput {
  scoreTotal: number;
  completedSeeds: number;
  nextScore: number;
  requiredSeeds: number;
  baselineScore: number;
  firstGeneration: boolean;
}

export interface RustSeedCohortResult {
  scoreTotal: number;
  completedSeeds: number;
  complete: boolean;
  averageScore: number;
  accepted: boolean | null;
}

export interface RustActionOutcome {
  action: RustPredictionAction;
  startingTroops: number;
  endingTroops: number;
  maxTroops: number;
  startingTiles: number;
  endingTiles: number;
  startingGold: number;
  endingGold: number;
  survived: boolean;
}

export interface RustActionRewardBaseline {
  mean: number;
  samples: number;
}

export interface RustNormalizedActionReward {
  learningSignal: number;
  baseline: RustActionRewardBaseline;
}

export interface RustActionOutcomeGenes {
  aggression: number;
  caution: number;
  naval: number;
}

type LearningWasmExports = OpenFrontWasmExports & {
  openfront_ai_predict_future_outcome(
    action: number,
    troops: number,
    maxTroops: number,
    tiles: number,
    enemyTroops: number,
    horizon: number,
    sample: number,
  ): number;
  openfront_ai_score_mutation_outcome(
    won: number,
    alive: number,
    playerCount: number,
    finishingRank: number,
    raidSuccessRate: number,
    retaliationRate: number,
    transportLossRate: number,
    predictionQuality: number,
    startingTiles: number,
    peakTiles: number,
    totalLandTiles: number,
    elapsedTicks: number,
    noGrowthTicks: number,
    longestNoGrowthTicks: number,
    peakCities: number,
    peakFactories: number,
  ): number;
  openfront_ai_classify_loss_cause(
    elapsedTicks: number,
    thirdPartyPressureTicks: number,
    maxIncomingRatio: number,
    lowReserveTicks: number,
    maxCommittedRatio: number,
    longestStallTicks: number,
    longestNoGrowthTicks: number,
    noGainTicks: number,
    peakTiles: number,
    peakCities: number,
  ): number;
  openfront_ai_evaluate_seed_cohort(
    scoreTotal: number,
    completedSeeds: number,
    nextScore: number,
    requiredSeeds: number,
    baselineScore: number,
    firstGeneration: number,
  ): number;
  openfront_ai_score_delayed_action_outcome(
    action: number,
    startingTroops: number,
    endingTroops: number,
    maxTroops: number,
    startingTiles: number,
    endingTiles: number,
    startingGold: number,
    endingGold: number,
    survived: number,
  ): number;
  openfront_ai_score_counterfactual_action_outcome(
    action: number,
    startingTroops: number,
    endingTroops: number,
    maxTroops: number,
    startingTiles: number,
    endingTiles: number,
    startingGold: number,
    endingGold: number,
    survived: number,
    expectedTroops: number,
    expectedTiles: number,
  ): number;
  openfront_ai_normalize_action_reward(
    reward: number,
    baselineMean: number,
    baselineSamples: number,
  ): number;
  openfront_ai_apply_action_outcome_learning(
    aggression: number,
    caution: number,
    naval: number,
    action: number,
    reward: number,
    priorSamples: number,
    attributionWeight: number,
  ): number;
};

class OpenFrontWasmLearningAi {
  private constructor(private readonly wasm: LearningWasmExports) {
    if ((this.wasm.openfront_abi_version() >>> 0) !== ABI_VERSION) {
      throw new Error("OpenFront learning AI Wasm ABI mismatch");
    }
    if ((this.wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront learning AI Wasm invalid-result sentinel mismatch");
    }
    for (const name of [
      "openfront_ai_predict_future_outcome",
      "openfront_ai_score_mutation_outcome",
      "openfront_ai_classify_loss_cause",
      "openfront_ai_evaluate_seed_cohort",
      "openfront_ai_score_delayed_action_outcome",
      "openfront_ai_score_counterfactual_action_outcome",
      "openfront_ai_normalize_action_reward",
      "openfront_ai_apply_action_outcome_learning",
    ] as const) {
      if (typeof this.wasm[name] !== "function") {
        throw new Error(`OpenFront Wasm is missing learning AI export ${name}`);
      }
    }
  }

  static async load(): Promise<OpenFrontWasmLearningAi> {
    const response = await fetch(assetUrl("wasm/openfront_wasm.wasm"));
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront learning AI Wasm: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmLearningAi(
      source.instance.exports as LearningWasmExports,
    );
  }

  predictFutureOutcome(
    input: RustFuturePredictionInput,
  ): RustFuturePredictionResult {
    if (
      this.wasm.openfront_ai_predict_future_outcome(
        actionCode(input.action),
        input.troops,
        input.maxTroops,
        input.tiles,
        input.enemyTroops,
        input.horizon,
        input.sample,
      ) === 0
    ) {
      this.throwLastError("predict future AI outcome");
    }
    const values = this.readF64Result(5, "read future AI prediction");
    return {
      expectedTroops: values[0]!,
      expectedTiles: values[1]!,
      confidence: values[2]!,
      expectedMaxTroops: values[3]!,
      capacityGain: values[4]!,
    };
  }

  scoreMutationOutcome(input: RustMutationOutcomeInput): number {
    return this.wasm.openfront_ai_score_mutation_outcome(
      input.won ? 1 : 0,
      input.alive ? 1 : 0,
      input.playerCount,
      input.finishingRank,
      input.raidSuccessRate,
      input.retaliationRate,
      input.transportLossRate,
      input.predictionQuality,
      input.startingTiles,
      input.peakTiles,
      input.totalLandTiles,
      input.elapsedTicks,
      input.noGrowthTicks,
      input.longestNoGrowthTicks,
      input.peakCities,
      input.peakFactories,
    );
  }

  classifyLossCause(input: RustLossCauseInput): number {
    return (
      this.wasm.openfront_ai_classify_loss_cause(
        input.elapsedTicks,
        input.thirdPartyPressureTicks,
        input.maxIncomingRatio,
        input.lowReserveTicks,
        input.maxCommittedRatio,
        input.longestStallTicks,
        input.longestNoGrowthTicks,
        input.noGainTicks,
        input.peakTiles,
        input.peakCities,
      ) >>> 0
    );
  }

  evaluateSeedCohort(input: RustSeedCohortInput): RustSeedCohortResult {
    if (
      this.wasm.openfront_ai_evaluate_seed_cohort(
        input.scoreTotal,
        input.completedSeeds >>> 0,
        input.nextScore,
        input.requiredSeeds >>> 0,
        input.baselineScore,
        input.firstGeneration ? 1 : 0,
      ) === 0
    ) {
      this.throwLastError("evaluate AI seed cohort");
    }
    const control = this.readU32Result(3, "read AI seed cohort state");
    const values = this.readF64Result(2, "read AI seed cohort values");
    return {
      scoreTotal: values[0]!,
      completedSeeds: control[0]!,
      complete: control[1] !== 0,
      averageScore: values[1]!,
      accepted:
        control[2] === 0 ? null : control[2] === 2,
    };
  }

  scoreDelayedActionOutcome(outcome: RustActionOutcome): number {
    return this.wasm.openfront_ai_score_delayed_action_outcome(
      actionCode(outcome.action),
      outcome.startingTroops,
      outcome.endingTroops,
      outcome.maxTroops,
      outcome.startingTiles,
      outcome.endingTiles,
      outcome.startingGold,
      outcome.endingGold,
      outcome.survived ? 1 : 0,
    );
  }

  scoreCounterfactualActionOutcome(
    outcome: RustActionOutcome & {
      expectedTroops: number;
      expectedTiles: number;
    },
  ): number {
    return this.wasm.openfront_ai_score_counterfactual_action_outcome(
      actionCode(outcome.action),
      outcome.startingTroops,
      outcome.endingTroops,
      outcome.maxTroops,
      outcome.startingTiles,
      outcome.endingTiles,
      outcome.startingGold,
      outcome.endingGold,
      outcome.survived ? 1 : 0,
      outcome.expectedTroops,
      outcome.expectedTiles,
    );
  }

  normalizeActionReward(
    reward: number,
    baseline: RustActionRewardBaseline,
  ): RustNormalizedActionReward {
    if (
      this.wasm.openfront_ai_normalize_action_reward(
        reward,
        baseline.mean,
        baseline.samples >>> 0,
      ) === 0
    ) {
      this.throwLastError("normalize AI action reward");
    }
    const control = this.readU32Result(1, "read AI reward sample count");
    const values = this.readF64Result(2, "read AI normalized reward");
    return {
      learningSignal: values[0]!,
      baseline: { mean: values[1]!, samples: control[0]! },
    };
  }

  applyActionOutcomeLearning(
    genes: RustActionOutcomeGenes,
    action: RustPredictionAction,
    reward: number,
    priorSamples: number,
    attributionWeight: number,
  ): RustActionOutcomeGenes {
    if (
      this.wasm.openfront_ai_apply_action_outcome_learning(
        genes.aggression,
        genes.caution,
        genes.naval,
        actionCode(action),
        reward,
        priorSamples,
        attributionWeight,
      ) === 0
    ) {
      this.throwLastError("apply AI action learning");
    }
    const values = this.readF64Result(3, "read AI learned genes");
    return {
      aggression: values[0]!,
      caution: values[1]!,
      naval: values[2]!,
    };
  }

  private readU32Result(expected: number, operation: string): Uint32Array {
    const length = this.wasm.openfront_result_len() >>> 0;
    if (length !== expected) {
      throw new Error(`${operation}: expected ${expected} words, got ${length}`);
    }
    const pointer = this.wasm.openfront_result_ptr() >>> 0;
    return new Uint32Array(
      new Uint32Array(this.wasm.memory.buffer, pointer, length),
    );
  }

  private readF64Result(expected: number, operation: string): Float64Array {
    const length = this.wasm.openfront_result_f64_len() >>> 0;
    if (length !== expected) {
      throw new Error(`${operation}: expected ${expected} lanes, got ${length}`);
    }
    const pointer = this.wasm.openfront_result_f64_ptr() >>> 0;
    return new Float64Array(
      new Float64Array(this.wasm.memory.buffer, pointer, length),
    );
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

function actionCode(action: RustPredictionAction): number {
  return ACTION_CODES[action] ?? 0;
}

let rustLearningAi: OpenFrontWasmLearningAi | null = null;
let rustLearningAiLoad: Promise<void> | null = null;
let rustLearningAiDisabled = false;
let rustLearningAiFailureLogged = false;

export function preloadRustLearningAi(): Promise<void> {
  if (rustLearningAi !== null || rustLearningAiDisabled) {
    return Promise.resolve();
  }
  if (rustLearningAiLoad !== null) return rustLearningAiLoad;
  rustLearningAiLoad = OpenFrontWasmLearningAi.load()
    .then((ai) => {
      rustLearningAi = ai;
    })
    .catch((error: unknown) => {
      rustLearningAiDisabled = true;
      logRustLearningAiFailure(error);
    });
  return rustLearningAiLoad;
}

function useRustLearningAi<T>(
  operation: (ai: OpenFrontWasmLearningAi) => T,
): T | null {
  if (rustLearningAi === null || rustLearningAiDisabled) return null;
  try {
    return operation(rustLearningAi);
  } catch (error) {
    rustLearningAi = null;
    rustLearningAiDisabled = true;
    logRustLearningAiFailure(error);
    return null;
  }
}

export function predictFutureOutcomeRust(
  input: RustFuturePredictionInput,
): RustFuturePredictionResult | null {
  return useRustLearningAi((ai) => ai.predictFutureOutcome(input));
}

export function scoreMutationOutcomeRust(
  input: RustMutationOutcomeInput,
): number | null {
  return useRustLearningAi((ai) => ai.scoreMutationOutcome(input));
}

export function classifyLossCauseRust(input: RustLossCauseInput): number | null {
  return useRustLearningAi((ai) => ai.classifyLossCause(input));
}

export function evaluateSeedCohortRust(
  input: RustSeedCohortInput,
): RustSeedCohortResult | null {
  return useRustLearningAi((ai) => ai.evaluateSeedCohort(input));
}

export function scoreDelayedActionOutcomeRust(
  outcome: RustActionOutcome,
): number | null {
  return useRustLearningAi((ai) => ai.scoreDelayedActionOutcome(outcome));
}

export function scoreCounterfactualActionOutcomeRust(
  outcome: RustActionOutcome & {
    expectedTroops: number;
    expectedTiles: number;
  },
): number | null {
  return useRustLearningAi((ai) => ai.scoreCounterfactualActionOutcome(outcome));
}

export function normalizeActionRewardRust(
  reward: number,
  baseline: RustActionRewardBaseline,
): RustNormalizedActionReward | null {
  return useRustLearningAi((ai) => ai.normalizeActionReward(reward, baseline));
}

export function applyActionOutcomeLearningRust(
  genes: RustActionOutcomeGenes,
  action: RustPredictionAction,
  reward: number,
  priorSamples: number,
  attributionWeight = 1,
): RustActionOutcomeGenes | null {
  return useRustLearningAi((ai) =>
    ai.applyActionOutcomeLearning(
      genes,
      action,
      reward,
      priorSamples,
      attributionWeight,
    ),
  );
}

function logRustLearningAiFailure(error: unknown): void {
  if (rustLearningAiFailureLogged) return;
  rustLearningAiFailureLogged = true;
  console.warn("Rust learning AI disabled; using TypeScript fallback", error);
}
