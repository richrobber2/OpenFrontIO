// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  planAdaptivePortActions,
  rankAdaptiveTradePortOptions,
  type AdaptivePortAction,
  type AdaptivePortContext,
  type AdaptiveTradePortOption,
} from "../../src/client/ai/AdaptivePortPolicy";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports & {
  openfront_ai_plan_adaptive_port_actions(...args: number[]): number;
  openfront_ai_score_adaptive_trade_port_option(...args: number[]): number;
};

const ACTION_CODES: Record<AdaptivePortAction, number> = {
  hold: 0,
  connect: 1,
  defend: 2,
  repair: 3,
  trade: 4,
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

function context(overrides: Partial<AdaptivePortContext> = {}): AdaptivePortContext {
  return {
    reserveRatio: 0.82,
    incomingPressureRatio: 0,
    activeFrontRatio: 0.15,
    gold: 4_000_000,
    spendableGold: 2_000_000,
    portCost: 250_000,
    ports: 2,
    connectedPorts: 2,
    tradePartners: 12,
    embargoedPartners: 1,
    ownWarships: 5,
    desiredWarships: 4,
    hostileWarships: 1,
    hostileTransports: 1,
    tradeTargets: 10,
    damagedWarships: 0,
    dockCapacity: 2,
    transportLossRate: 0.08,
    railProductivityRatio: 0.85,
    navalBias: 1.2,
    economicTradeCoverageTargetRatio: 0.15,
    ...overrides,
  };
}

function planArgs(input: AdaptivePortContext): number[] {
  return [
    input.reserveRatio,
    input.incomingPressureRatio,
    input.activeFrontRatio,
    input.gold,
    input.spendableGold,
    input.portCost,
    input.ports,
    input.connectedPorts,
    input.tradePartners,
    input.embargoedPartners,
    input.ownWarships,
    input.desiredWarships,
    input.hostileWarships,
    input.hostileTransports,
    input.tradeTargets,
    input.damagedWarships,
    input.dockCapacity,
    input.transportLossRate,
    input.railProductivityRatio,
    input.navalBias,
    input.economicTradeCoverageTargetRatio === undefined ? 0 : 1,
    input.economicTradeCoverageTargetRatio ?? 0,
  ];
}

function normalization(options: AdaptiveTradePortOption[]) {
  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(maximum, value));
  const routeDistances = options.map((option) =>
    Math.max(0, option.routeDistance),
  );
  const spacingDistances = options.map((option) =>
    Math.max(0, option.closestFriendlyPortDistance),
  );
  const goldRates = options.map((option) => {
    const survival = clamp(option.survivalRatio ?? 1, 0, 1);
    return (
      (Math.max(0, option.expectedGold) * survival) /
      Math.max(1, option.routeDistance + (option.spawnIntervalTicks ?? 100))
    );
  });
  return {
    minimumRoute: Math.min(...routeDistances),
    maximumRoute: Math.max(...routeDistances),
    minimumSpacing: Math.min(...spacingDistances),
    maximumSpacing: Math.max(...spacingDistances),
    minimumGoldRate: Math.min(...goldRates),
    maximumGoldRate: Math.max(...goldRates),
  };
}

describe("adaptive port AI TypeScript/WebAssembly parity", () => {
  it("matches the live port action planner across growth and defense states", async () => {
    const wasm = await loadWasm();
    const scenarios = [
      context(),
      context({ ports: 3, connectedPorts: 0, tradeTargets: 0 }),
      context({
        incomingPressureRatio: 0.9,
        activeFrontRatio: 0.8,
        reserveRatio: 0.42,
        ownWarships: 1,
        desiredWarships: 6,
        hostileWarships: 9,
        hostileTransports: 5,
      }),
    ];

    for (const input of scenarios) {
      const ts = planAdaptivePortActions(input);
      expect(wasm.openfront_ai_plan_adaptive_port_actions(...planArgs(input))).toBe(1);
      const control = readU32Result(wasm);
      const values = readF64Result(wasm);
      expect(control).toHaveLength(2);
      expect(values).toHaveLength(22);
      expect(control[0]).toBe(ACTION_CODES[ts.action]);
      expect(control[1] !== 0).toBe(ts.requireFactoryConnection);
      expect(values[0]).toBeCloseTo(ts.urgency, 12);
      expect(values[1]).toBeCloseTo(ts.scores.hold, 12);
      expect(values[2]).toBeCloseTo(ts.scores.connect, 12);
      expect(values[3]).toBeCloseTo(ts.scores.defend, 12);
      expect(values[4]).toBeCloseTo(ts.scores.repair, 12);
      expect(values[5]).toBeCloseTo(ts.scores.trade, 12);
      expect(values[6]).toBeCloseTo(ts.connectedPortRatio, 12);
      expect(values[7]).toBeCloseTo(ts.fleetCoverageRatio, 12);
      expect(values[8]).toBeCloseTo(ts.repairLoadRatio, 12);
      expect(values[9]).toBeCloseTo(ts.navalThreatRatio, 12);
      expect(values[10]).toBeCloseTo(ts.tradeCoverageRatio, 12);
      expect(values[11]).toBeCloseTo(ts.budgetCoverageRatio, 12);
      expect(values[12]).toBeCloseTo(ts.targetPartnerCoverageRatio, 12);
      expect(values[13]).toBeCloseTo(ts.candidateSampleRatio, 12);
      expect(values[14]).toBeCloseTo(ts.targetCoverageRatio, 12);
      expect(values[15]).toBeCloseTo(ts.minimumSiteQuality, 12);
      expect(values[16]).toBeCloseTo(ts.minimumBudgetCoverage, 12);
      expect(values[17]).toBeCloseTo(ts.requiredReturnRatio, 12);
      expect(values[18]).toBeCloseTo(ts.maximumPaybackTicks, 9);
      expect(values[19]).toBeCloseTo(ts.repairHealthThreshold, 12);
      expect(values[20]).toBeCloseTo(ts.stackingLoadThreshold, 12);
      expect(values[21]).toBeCloseTo(ts.constructionPressure, 12);
    }
  });

  it("prefers the shorter equally productive route instead of ignoring exposure", async () => {
    const wasm = await loadWasm();
    const plan = {
      minimumSiteQuality: 0,
      requiredReturnRatio: 0.1,
      maximumPaybackTicks: 10_000,
      requireFactoryConnection: true,
    };
    const options: AdaptiveTradePortOption[] = [
      {
        id: "short",
        expectedGold: 60_000,
        buildCost: 250_000,
        routeDistance: 100,
        closestFriendlyPortDistance: 100,
        factoryConnected: true,
        survivalRatio: 1,
        spawnIntervalTicks: 500,
        reachablePartners: 3,
        partnerConcentration: 0.5,
      },
      {
        id: "long",
        expectedGold: 60_000,
        buildCost: 250_000,
        routeDistance: 300,
        closestFriendlyPortDistance: 100,
        factoryConnected: true,
        survivalRatio: 1,
        spawnIntervalTicks: 300,
        reachablePartners: 3,
        partnerConcentration: 0.5,
      },
    ];
    const ranked = rankAdaptiveTradePortOptions(plan, options);
    expect(ranked.map((option) => option.id)).toEqual(["short", "long"]);
    expect(ranked[0]!.score - ranked[1]!.score).toBeCloseTo(0.05, 12);

    const norm = normalization(options);
    for (const option of options) {
      expect(
        wasm.openfront_ai_score_adaptive_trade_port_option(
          plan.minimumSiteQuality,
          plan.requiredReturnRatio,
          plan.maximumPaybackTicks,
          1,
          option.expectedGold,
          option.buildCost,
          option.routeDistance,
          option.closestFriendlyPortDistance,
          1,
          option.survivalRatio ?? 1,
          option.spawnIntervalTicks ?? 100,
          option.reachablePartners ?? 1,
          option.partnerConcentration ?? 1,
          norm.minimumRoute,
          norm.maximumRoute,
          norm.minimumSpacing,
          norm.maximumSpacing,
          norm.minimumGoldRate,
          norm.maximumGoldRate,
        ),
      ).toBe(1);
      const control = readU32Result(wasm);
      const values = readF64Result(wasm);
      const ts = ranked.find((candidate) => candidate.id === option.id)!;
      expect(control[0] !== 0).toBe(true);
      expect(values[0]).toBeCloseTo(ts.score, 12);
      expect(values[1]).toBeCloseTo(ts.returnRatio, 12);
      expect(values[2]).toBeCloseTo(ts.distanceEfficiency, 12);
      expect(values[3]).toBeCloseTo(ts.spacingQuality, 12);
      expect(values[4]).toBeCloseTo(ts.expectedGoldPerTick, 12);
      expect(values[5]).toBeCloseTo(ts.paybackTicks, 9);
      expect(values[6]).toBeCloseTo(ts.diversityQuality, 12);
    }
  });

  it("keeps low-return or disconnected trade sites out of the ranked set", () => {
    const plan = {
      minimumSiteQuality: 0.4,
      requiredReturnRatio: 0.25,
      maximumPaybackTicks: 3_600,
      requireFactoryConnection: true,
    };
    const ranked = rankAdaptiveTradePortOptions(plan, [
      {
        id: "good",
        expectedGold: 100_000,
        buildCost: 250_000,
        routeDistance: 250,
        closestFriendlyPortDistance: 200,
        factoryConnected: true,
        survivalRatio: 0.9,
        spawnIntervalTicks: 100,
        reachablePartners: 4,
        partnerConcentration: 0.35,
      },
      {
        id: "cheap-return",
        expectedGold: 20_000,
        buildCost: 250_000,
        routeDistance: 200,
        closestFriendlyPortDistance: 250,
        factoryConnected: true,
      },
      {
        id: "isolated",
        expectedGold: 120_000,
        buildCost: 250_000,
        routeDistance: 200,
        closestFriendlyPortDistance: 300,
        factoryConnected: false,
      },
    ]);
    expect(ranked.map((option) => option.id)).toEqual(["good"]);
  });
});
