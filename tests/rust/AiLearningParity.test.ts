// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyActionOutcomeLearning,
  normalizeActionReward,
  scoreCounterfactualActionOutcome,
  scoreDelayedActionOutcome,
} from "../../src/client/ai/ActionOutcomeLearning";
import {
  classifyLossCause,
  evaluateSeedCohort,
  LossCause,
  predictFutureOutcome,
  scoreMutationOutcome,
  type PredictionAction,
} from "../../src/client/ai/StrategyMath";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports & {
  openfront_ai_predict_future_outcome(
    action: number,
    troops: number,
    maxTroops: number,
    tiles: number,
    enemyTroops: number,
    horizon: number,
    sample: number,
  ): number;
  openfront_ai_score_mutation_outcome(...args: number[]): number;
  openfront_ai_classify_loss_cause(...args: number[]): number;
  openfront_ai_evaluate_seed_cohort(...args: number[]): number;
  openfront_ai_score_delayed_action_outcome(...args: number[]): number;
  openfront_ai_score_counterfactual_action_outcome(...args: number[]): number;
  openfront_ai_normalize_action_reward(...args: number[]): number;
  openfront_ai_apply_action_outcome_learning(...args: number[]): number;
};

const ACTION_CODES: Record<PredictionAction, number> = {
  hold: 0,
  attack: 1,
  expand: 2,
  defend: 3,
  fleet: 4,
};

async function loadWasm(): Promise<Wasm> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  const source = await WebAssembly.instantiate(
    new Uint8Array(await readFile(wasmPath)),
    {},
  );
  return source.instance.exports as Wasm;
}

function readU32Result(wasm: Wasm): Uint32Array {
  const length = wasm.openfront_result_len() >>> 0;
  const pointer = wasm.openfront_result_ptr() >>> 0;
  return new Uint32Array(new Uint32Array(wasm.memory.buffer, pointer, length));
}

function readF64Result(wasm: Wasm): Float64Array {
  const length = wasm.openfront_result_f64_len() >>> 0;
  const pointer = wasm.openfront_result_f64_ptr() >>> 0;
  return new Float64Array(new Float64Array(wasm.memory.buffer, pointer, length));
}

describe("growth-aware AI learning TypeScript/WebAssembly parity", () => {
  it("matches forward predictions across actions and horizons", async () => {
    const wasm = await loadWasm();
    const scenarios = [
      { action: "hold" as const, horizon: 90, sample: 2 },
      { action: "attack" as const, horizon: 180, sample: 1 },
      { action: "expand" as const, horizon: 60, sample: 3 },
      { action: "expand" as const, horizon: 300, sample: 2 },
      { action: "fleet" as const, horizon: 120, sample: 4 },
    ];

    for (const scenario of scenarios) {
      const input = {
        ...scenario,
        troops: 800_000,
        maxTroops: 1_000_000,
        tiles: 5_000,
        enemyTroops: 700_000,
      };
      const ts = predictFutureOutcome(input);
      expect(
        wasm.openfront_ai_predict_future_outcome(
          ACTION_CODES[input.action],
          input.troops,
          input.maxTroops,
          input.tiles,
          input.enemyTroops,
          input.horizon,
          input.sample,
        ),
      ).toBe(1);
      const values = readF64Result(wasm);
      expect(values).toHaveLength(5);
      expect(values[0]).toBeCloseTo(ts.expectedTroops, 7);
      expect(values[1]).toBeCloseTo(ts.expectedTiles, 8);
      expect(values[2]).toBeCloseTo(ts.confidence, 10);
      expect(values[3]).toBeCloseTo(ts.expectedMaxTroops, 7);
      expect(values[4]).toBeCloseTo(ts.capacityGain, 7);
    }
  });

  it("credits longer expansion with compounding land capacity", () => {
    const base = {
      action: "expand" as const,
      troops: 800_000,
      maxTroops: 1_000_000,
      tiles: 5_000,
      enemyTroops: 700_000,
      sample: 2,
    };
    const short = predictFutureOutcome({ ...base, horizon: 60 });
    const long = predictFutureOutcome({ ...base, horizon: 300 });
    expect(long.expectedTiles).toBeGreaterThan(short.expectedTiles);
    expect(long.capacityGain).toBeGreaterThan(short.capacityGain);
    expect(long.expectedMaxTroops).toBeGreaterThan(short.expectedMaxTroops);
    expect(long.confidence).toBeLessThan(short.confidence);
  });

  it("matches growth-biased mutation scoring and rewards growth pace", async () => {
    const wasm = await loadWasm();
    const base = {
      won: false,
      alive: true,
      playerCount: 10,
      finishingRank: 3,
      raidSuccessRate: 0.5,
      retaliationRate: 0.1,
      transportLossRate: 0.1,
      predictionQuality: 0.2,
      startingTiles: 1_000,
      peakTiles: 6_000,
      totalLandTiles: 50_000,
      noGrowthTicks: 20,
      longestNoGrowthTicks: 40,
      peakCities: 4,
      peakFactories: 2,
    };
    const fast = scoreMutationOutcome({ ...base, elapsedTicks: 2_000 });
    const slow = scoreMutationOutcome({ ...base, elapsedTicks: 8_000 });
    expect(fast).toBeGreaterThan(slow);

    const args = [
      0,
      1,
      base.playerCount,
      base.finishingRank,
      base.raidSuccessRate,
      base.retaliationRate,
      base.transportLossRate,
      base.predictionQuality,
      base.startingTiles,
      base.peakTiles,
      base.totalLandTiles,
      2_000,
      base.noGrowthTicks,
      base.longestNoGrowthTicks,
      base.peakCities,
      base.peakFactories,
    ];
    expect(wasm.openfront_ai_score_mutation_outcome(...args)).toBeCloseTo(
      fast,
      9,
    );
  });

  it("matches loss diagnosis and seed cohort acceptance", async () => {
    const wasm = await loadWasm();
    const loss = {
      elapsedTicks: 2_000,
      thirdPartyPressureTicks: 100,
      maxIncomingRatio: 0.8,
      lowReserveTicks: 500,
      maxCommittedRatio: 0.8,
      longestStallTicks: 300,
      longestNoGrowthTicks: 500,
      noGainTicks: 500,
      peakTiles: 2_500,
      peakCities: 0,
    };
    const tsLoss = classifyLossCause(loss);
    expect(tsLoss).toBe(LossCause.Containment);
    expect(
      wasm.openfront_ai_classify_loss_cause(
        loss.elapsedTicks,
        loss.thirdPartyPressureTicks,
        loss.maxIncomingRatio,
        loss.lowReserveTicks,
        loss.maxCommittedRatio,
        loss.longestStallTicks,
        loss.longestNoGrowthTicks,
        loss.noGainTicks,
        loss.peakTiles,
        loss.peakCities,
      ),
    ).toBe(tsLoss);

    const cohort = {
      scoreTotal: 30,
      completedSeeds: 3,
      nextScore: 12,
      requiredSeeds: 4,
      baselineScore: 9,
      firstGeneration: false,
    };
    const tsCohort = evaluateSeedCohort(cohort);
    expect(
      wasm.openfront_ai_evaluate_seed_cohort(
        cohort.scoreTotal,
        cohort.completedSeeds,
        cohort.nextScore,
        cohort.requiredSeeds,
        cohort.baselineScore,
        cohort.firstGeneration ? 1 : 0,
      ),
    ).toBe(1);
    const control = readU32Result(wasm);
    const values = readF64Result(wasm);
    expect(values[0]).toBeCloseTo(tsCohort.scoreTotal, 12);
    expect(control[0]).toBe(tsCohort.completedSeeds);
    expect(control[1] !== 0).toBe(tsCohort.complete);
    expect(values[1]).toBeCloseTo(tsCohort.averageScore, 12);
    expect(control[2] === 0 ? null : control[2] === 2).toBe(
      tsCohort.accepted,
    );
  });

  it("matches delayed and counterfactual action learning", async () => {
    const wasm = await loadWasm();
    const outcome = {
      action: "expand" as const,
      startingTroops: 80_000,
      endingTroops: 85_000,
      maxTroops: 100_000,
      startingTiles: 100,
      endingTiles: 120,
      startingGold: 20_000,
      endingGold: 25_000,
      survived: true,
    };
    const outcomeArgs = [
      ACTION_CODES[outcome.action],
      outcome.startingTroops,
      outcome.endingTroops,
      outcome.maxTroops,
      outcome.startingTiles,
      outcome.endingTiles,
      outcome.startingGold,
      outcome.endingGold,
      1,
    ];
    expect(wasm.openfront_ai_score_delayed_action_outcome(...outcomeArgs)).toBeCloseTo(
      scoreDelayedActionOutcome(outcome),
      12,
    );
    expect(
      wasm.openfront_ai_score_counterfactual_action_outcome(
        ...outcomeArgs,
        82_000,
        110,
      ),
    ).toBeCloseTo(
      scoreCounterfactualActionOutcome({
        ...outcome,
        expectedTroops: 82_000,
        expectedTiles: 110,
      }),
      12,
    );

    const baseline = { mean: 0.2, samples: 8 };
    const normalized = normalizeActionReward(0.5, baseline);
    expect(
      wasm.openfront_ai_normalize_action_reward(
        0.5,
        baseline.mean,
        baseline.samples,
      ),
    ).toBe(1);
    const normalizedControl = readU32Result(wasm);
    const normalizedValues = readF64Result(wasm);
    expect(normalizedValues[0]).toBeCloseTo(normalized.learningSignal, 12);
    expect(normalizedValues[1]).toBeCloseTo(normalized.baseline.mean, 12);
    expect(normalizedControl[0]).toBe(normalized.baseline.samples);

    const genes = { aggression: 0.1, caution: -0.2, naval: 0.3 };
    const learned = applyActionOutcomeLearning(
      genes,
      "expand",
      0.4,
      12,
      0.75,
    );
    expect(
      wasm.openfront_ai_apply_action_outcome_learning(
        genes.aggression,
        genes.caution,
        genes.naval,
        ACTION_CODES.expand,
        0.4,
        12,
        0.75,
      ),
    ).toBe(1);
    const learnedValues = readF64Result(wasm);
    expect(learnedValues[0]).toBeCloseTo(learned.aggression, 12);
    expect(learnedValues[1]).toBeCloseTo(learned.caution, 12);
    expect(learnedValues[2]).toBeCloseTo(learned.naval, 12);
  });
});
