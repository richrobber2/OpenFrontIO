// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  selectCoalitionTarget,
  type CoalitionTargetOption,
} from "../../src/client/ai/CoalitionPlanningPolicy";
import {
  modelOpponent,
  planStrategicAction,
} from "../../src/client/ai/StrategicActionPlanner";
import {
  INVALID_RESULT,
  type OpenFrontWasmExports,
} from "../../src/client/rust/OpenFrontWasmTypes";

const HELPER_RECORD_BYTES = 24;
const OPPONENT_RECORD_BYTES = 24;
const ACTIONS = [
  "defend",
  "strike",
  "naval",
  "expand",
  "attack",
  "infrastructure",
] as const;

type Wasm = OpenFrontWasmExports;

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

function uploadBytes(wasm: Wasm, bytes: Uint8Array): number {
  const handle = wasm.openfront_upload_create(bytes.byteLength) >>> 0;
  expect(handle).not.toBe(0);
  const pointer = wasm.openfront_upload_ptr(handle) >>> 0;
  new Uint8Array(wasm.memory.buffer, pointer, bytes.byteLength).set(bytes);
  return handle;
}

function readU32Result(wasm: Wasm): Uint32Array {
  const length = wasm.openfront_result_len() >>> 0;
  const pointer = wasm.openfront_result_ptr() >>> 0;
  return new Uint32Array(
    new Uint32Array(wasm.memory.buffer, pointer, length),
  );
}

function readF64Result(wasm: Wasm): Float64Array {
  const length = wasm.openfront_result_f64_len() >>> 0;
  const pointer = wasm.openfront_result_f64_ptr() >>> 0;
  return new Float64Array(
    new Float64Array(wasm.memory.buffer, pointer, length),
  );
}

function evaluateCoalitionOption(
  wasm: Wasm,
  option: CoalitionTargetOption,
): { score: number; cost: number; states: number[] } {
  const bytes = new Uint8Array(option.helpers.length * HELPER_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < option.helpers.length; index++) {
    const helper = option.helpers[index]!;
    const offset = index * HELPER_RECORD_BYTES;
    view.setFloat64(offset, helper.reliability, true);
    view.setFloat64(offset + 8, helper.reserveRatio, true);
    view.setUint32(offset + 16, helper.canReach ? 1 : 0, true);
    view.setUint32(offset + 20, helper.treatyBlocked ? 1 : 0, true);
  }
  const upload = uploadBytes(wasm, bytes);
  try {
    expect(
      wasm.openfront_ai_coalition_target_evaluate(
        option.basePriority,
        option.enemyActiveWars,
        upload,
        option.helpers.length,
      ),
    ).toBe(1);
    const summary = readF64Result(wasm);
    const states = readU32Result(wasm);
    expect(summary.length).toBe(2);
    expect(states.length).toBe(option.helpers.length + 2);
    return {
      score: summary[0]!,
      cost: summary[1]!,
      states: Array.from(states.slice(2)),
    };
  } finally {
    wasm.openfront_upload_destroy(upload);
  }
}

function modelOpponentInRust(
  wasm: Wasm,
  input: Parameters<typeof modelOpponent>[0],
): ReturnType<typeof modelOpponent> {
  const predictedChoice =
    input.predictedChoice === "expand"
      ? 1
      : input.predictedChoice === "economy"
        ? 2
        : input.predictedChoice === "attack"
          ? 3
          : 0;
  expect(
    wasm.openfront_ai_model_opponent(
      input.troops,
      input.maxTroops,
      input.tiles,
      input.ownTiles,
      input.incomingAttacks,
      input.outgoingAttacks,
      input.silos,
      input.warships,
      input.previousTiles ?? input.tiles,
      input.previousTroops ?? input.troops,
      input.elapsedTicks ?? 1,
      predictedChoice,
      input.forecastThreat ?? 0,
    ),
  ).toBe(1);
  const values = readF64Result(wasm);
  expect(values.length).toBe(8);
  return {
    id: input.id,
    troopRatio: values[0]!,
    territoryRatio: values[1]!,
    territoryGrowthRate: values[2]!,
    troopGrowthRate: values[3]!,
    growthPressure: values[4]!,
    militaryPressure: values[5]!,
    siloCount: values[6]!,
    navalPressure: values[7]!,
    predictedChoice: input.predictedChoice,
    forecastThreat: input.forecastThreat,
  };
}

describe("strategic AI TypeScript/WebAssembly parity", () => {
  it("uses reachable reliable allies to change coalition target value", async () => {
    const wasm = await loadWasm();
    const options: CoalitionTargetOption[] = [
      {
        targetId: "solo",
        basePriority: 6,
        ownCanReach: true,
        enemyActiveWars: 0,
        helpers: [],
      },
      {
        targetId: "coalition",
        basePriority: 4.5,
        ownCanReach: true,
        enemyActiveWars: 1,
        helpers: [
          {
            allyId: "useful",
            reliability: 0.92,
            reserveRatio: 0.82,
            canReach: true,
            treatyBlocked: false,
          },
          {
            allyId: "blocked",
            reliability: 1,
            reserveRatio: 1,
            canReach: true,
            treatyBlocked: true,
          },
        ],
      },
    ];

    const rust = options.map((option) => evaluateCoalitionOption(wasm, option));
    const rustWinner = rust[0]!.score >= rust[1]!.score ? options[0]! : options[1]!;
    const typescript = selectCoalitionTarget(options)!;

    expect(typescript.targetId).toBe(rustWinner.targetId);
    expect(rust[1]!.states).toEqual([1, 2]);
    expect(typescript.availableHelperIds).toEqual(["useful"]);
    expect(typescript.treatyBlockedHelperIds).toEqual(["blocked"]);
    expect(typescript.offensiveCostMultiplier).toBeCloseTo(rust[1]!.cost, 12);
  });

  it("models opponent pressure identically", async () => {
    const wasm = await loadWasm();
    const input: Parameters<typeof modelOpponent>[0] = {
      id: "enemy",
      troops: 72_000,
      maxTroops: 100_000,
      tiles: 1_600,
      ownTiles: 1_250,
      incomingAttacks: 1,
      outgoingAttacks: 2,
      silos: 3,
      warships: 4,
      previousTiles: 1_540,
      previousTroops: 68_000,
      elapsedTicks: 20,
      predictedChoice: "attack",
      forecastThreat: 0.8,
    };

    const rust = modelOpponentInRust(wasm, input);
    const typescript = modelOpponent(input);

    expect(rust).toEqual({
      ...typescript,
      troopRatio: expect.closeTo(typescript.troopRatio, 12),
      territoryRatio: expect.closeTo(typescript.territoryRatio, 12),
      territoryGrowthRate: expect.closeTo(typescript.territoryGrowthRate, 12),
      troopGrowthRate: expect.closeTo(typescript.troopGrowthRate, 12),
      growthPressure: expect.closeTo(typescript.growthPressure, 12),
      militaryPressure: expect.closeTo(typescript.militaryPressure, 12),
      siloCount: expect.closeTo(typescript.siloCount, 12),
      navalPressure: expect.closeTo(typescript.navalPressure, 12),
    });
  });

  it("chooses the same top-level action and strongest opponent", async () => {
    const wasm = await loadWasm();
    const opponents = [
      modelOpponent({
        id: "alpha",
        troops: 80_000,
        maxTroops: 100_000,
        tiles: 1_400,
        ownTiles: 1_200,
        incomingAttacks: 1,
        outgoingAttacks: 2,
        silos: 2,
        warships: 1,
        previousTiles: 1_320,
        previousTroops: 76_000,
        elapsedTicks: 20,
        predictedChoice: "attack",
        forecastThreat: 0.7,
      }),
      modelOpponent({
        id: "beta",
        troops: 45_000,
        maxTroops: 100_000,
        tiles: 900,
        ownTiles: 1_200,
        incomingAttacks: 0,
        outgoingAttacks: 0,
        silos: 0,
        warships: 0,
      }),
    ];
    const input = {
      reserveRatio: 0.67,
      incomingFronts: 0,
      incomingTroops: 0,
      maxTroops: 100_000,
      hasNeutralLand: false,
      hostileBorders: 2,
      activeNationWars: 0,
      navalThreats: 1,
      tradeTargets: 2,
      navalPressureRatio: 0.2,
      tradeOpportunityRatio: 0.4,
      siloTargets: 2,
      readyStrategicSlots: 1,
      affordableStrategicWeapons: 1,
      actionableStrikeTargets: 2,
      opponents,
    };
    const typescript = planStrategicAction(input);

    const bytes = new Uint8Array(opponents.length * OPPONENT_RECORD_BYTES);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < opponents.length; index++) {
      const opponent = opponents[index]!;
      const offset = index * OPPONENT_RECORD_BYTES;
      view.setFloat64(offset, opponent.militaryPressure, true);
      view.setFloat64(offset + 8, opponent.growthPressure, true);
      view.setFloat64(offset + 16, opponent.siloCount, true);
    }
    const upload = uploadBytes(wasm, bytes);
    try {
      expect(
        wasm.openfront_ai_plan_strategic_action(
          input.reserveRatio,
          input.incomingFronts,
          input.incomingTroops,
          input.maxTroops,
          input.hasNeutralLand ? 1 : 0,
          input.hostileBorders,
          input.activeNationWars,
          input.navalThreats,
          input.tradeTargets,
          input.navalPressureRatio,
          input.tradeOpportunityRatio,
          input.readyStrategicSlots,
          input.affordableStrategicWeapons,
          input.actionableStrikeTargets,
          upload,
          opponents.length,
        ),
      ).toBe(1);
      const control = readU32Result(wasm);
      const scores = readF64Result(wasm);
      expect(control.length).toBe(3);
      expect(scores.length).toBe(7);

      const rustAction = ACTIONS[control[0]!]!;
      const strongestIndex = control[1] === INVALID_RESULT ? undefined : control[1];
      expect(rustAction).toBe(typescript.action);
      expect(strongestIndex).toBe(
        typescript.opponent === undefined
          ? undefined
          : opponents.indexOf(typescript.opponent),
      );
      for (let index = 0; index < ACTIONS.length; index++) {
        expect(scores[index]).toBeCloseTo(typescript.scores[ACTIONS[index]!], 12);
      }
    } finally {
      wasm.openfront_upload_destroy(upload);
    }
  });
});
