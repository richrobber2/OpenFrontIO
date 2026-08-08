// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  capacityEscapeCityBudget,
  planEconomicSystems,
  shouldFundFirstPressureFactory,
  type EconomicSystemAction,
  type EconomicSystemContext,
} from "../../src/client/ai/EconomicSystemPolicy";
import {
  estimateTradeRouteGold,
  railCityGrowthScore,
  scoreCityStackPlacement,
  scoreFactoryPlacement,
} from "../../src/client/ai/StrategyMath";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports & {
  openfront_ai_rail_city_growth_score(...args: number[]): number;
  openfront_ai_score_city_stack_placement(...args: number[]): number;
  openfront_ai_score_factory_placement(...args: number[]): number;
  openfront_ai_estimate_trade_route_gold(...args: number[]): number;
  openfront_ai_capacity_escape_city_budget(...args: number[]): number;
  openfront_ai_should_fund_first_pressure_factory(...args: number[]): number;
  openfront_ai_plan_economic_systems(...args: number[]): number;
};

const ACTION_CODES: Record<EconomicSystemAction, number> = {
  bank: 0,
  "protect-assets": 1,
  "stack-capacity": 2,
  "activate-rail": 3,
  "extend-trade": 4,
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

function economicArgs(context: EconomicSystemContext): number[] {
  const factoryConnectedPorts = Math.max(0, context.factoryConnectedPorts ?? 0);
  const unconnectedPorts = Math.max(
    0,
    context.unconnectedPorts ??
      Math.max(0, context.ports - factoryConnectedPorts),
  );
  return [
    context.gold,
    context.incomePerMinute,
    context.reserveRatio,
    context.incomingTroopRatio,
    context.hostileFronts,
    context.activeNationWars,
    context.hasNeutralLand ? 1 : 0,
    context.trapped ? 1 : 0,
    context.cities,
    context.desiredCities,
    context.stackedCities,
    context.factories,
    context.productiveFactoryStops,
    context.isolatedFactories,
    context.ports,
    factoryConnectedPorts,
    unconnectedPorts,
    context.tradePartners,
    context.embargoedPartners,
    context.railStops,
    context.connectedRailStops,
    context.defensePosts,
    context.strategicStructures,
    context.exposedEconomicStructures,
    context.cityCost,
    context.factoryCost,
    context.portCost,
    context.defensePostCost,
  ];
}

describe("growth-aware AI economy TypeScript/WebAssembly parity", () => {
  it("strongly prefers a productive city directly on existing rail", async () => {
    const wasm = await loadWasm();
    const offTrack = railCityGrowthScore(1, 0);
    const onTrack = railCityGrowthScore(1, 1);
    const crowdedTrack = railCityGrowthScore(1, 10);

    expect(offTrack).toBe(20);
    expect(onTrack).toBe(75);
    expect(onTrack).toBeGreaterThan(offTrack + 40);
    expect(crowdedTrack).toBeLessThan(onTrack + 60);
    expect(wasm.openfront_ai_rail_city_growth_score(1, 0)).toBe(offTrack);
    expect(wasm.openfront_ai_rail_city_growth_score(1, 1)).toBe(onTrack);
    expect(wasm.openfront_ai_rail_city_growth_score(1, 10)).toBe(crowdedTrack);
  });

  it("matches city stacking geometry", async () => {
    const wasm = await loadWasm();
    const input = {
      cityDistancesSquared: [18 ** 2, 28 ** 2, 80 ** 2],
      structureMinDistance: 16,
    };
    const ts = scoreCityStackPlacement(input);
    expect(
      wasm.openfront_ai_score_city_stack_placement(
        1,
        18,
        2,
        input.structureMinDistance,
      ),
    ).toBe(1);
    const control = readU32Result(wasm);
    const values = readF64Result(wasm);
    expect(values[0]).toBeCloseTo(ts.score, 12);
    expect(control[0]).toBe(ts.nearbyCities);
    expect(control[1] !== 0).toBe(ts.stacked);
    expect(control[2] !== 0).toBe(ts.nearestCityDistance !== null);
    expect(values[1]).toBeCloseTo(ts.nearestCityDistance ?? 0, 12);
  });

  it("values productive existing rail above an equivalent fresh factory route", async () => {
    const wasm = await loadWasm();
    const base = {
      ownCities: 2,
      ownPorts: 0,
      externalCities: 1,
      externalPorts: 0,
      factoryCorridorConnections: 0,
      ghostPathLengths: [60, 60] as const,
      railBends: 2,
      depth: 8,
      safestDepth: 10,
      minimumRange: 15,
      maximumRange: 110,
    };
    const fresh = scoreFactoryPlacement({
      ...base,
      overlappingRailroads: 0,
    });
    const reused = scoreFactoryPlacement({
      ...base,
      overlappingRailroads: 1,
    });
    expect(reused.score).toBeGreaterThan(fresh.score + 40);
    expect(reused.railReuseScore).toBeGreaterThan(fresh.railReuseScore);

    const pathTiles = 120;
    const routeCount = 3;
    expect(
      wasm.openfront_ai_score_factory_placement(
        base.ownCities,
        base.ownPorts,
        base.externalCities,
        base.externalPorts,
        base.factoryCorridorConnections,
        1,
        pathTiles,
        routeCount,
        base.railBends,
        base.depth,
        base.safestDepth,
        0,
        0,
        base.minimumRange,
        base.maximumRange,
      ),
    ).toBe(1);
    const values = readF64Result(wasm);
    expect(values[0]).toBeCloseTo(reused.score, 10);
    expect(values[1]).toBeCloseTo(reused.productiveStops, 12);
    expect(values[2]).toBeCloseTo(reused.railEfficiency, 12);
    expect(values[3]).toBeCloseTo(reused.railReuseScore, 12);
  });

  it("matches the engine-shaped trade return formula", async () => {
    const wasm = await loadWasm();
    expect(estimateTradeRouteGold(300, 300)).toBe(52_500);
    for (const distance of [100, 300, 600, 900]) {
      expect(wasm.openfront_ai_estimate_trade_route_gold(distance, 300)).toBe(
        estimateTradeRouteGold(distance, 300),
      );
    }
  });

  it("matches capacity escape budgeting", async () => {
    const wasm = await loadWasm();
    const input = {
      gold: 1_000_000,
      protectedSpendableGold: 100_000,
      cityCost: 250_000,
      cities: 2,
      desiredCities: 4,
      requiredTroops: 1_300_000,
      maxTroops: 1_000_000,
      incomingFronts: 0,
      hostileFronts: 2,
      activeNationWars: 0,
      reserveRatio: 0.8,
    };
    const ts = capacityEscapeCityBudget(input);
    expect(
      wasm.openfront_ai_capacity_escape_city_budget(
        input.gold,
        input.protectedSpendableGold,
        input.cityCost,
        input.cities,
        input.desiredCities,
        input.requiredTroops,
        input.maxTroops,
        input.incomingFronts,
        input.hostileFronts,
        input.activeNationWars,
        input.reserveRatio,
      ),
    ).toBe(1);
    const control = readU32Result(wasm);
    const values = readF64Result(wasm);
    expect(control[0] !== 0).toBe(ts.bypassBank);
    expect(values[0]).toBeCloseTo(ts.spendableGold, 12);
  });

  it("unlocks the first growth factory during a healthy midgame stall", async () => {
    const wasm = await loadWasm();
    const base = {
      factories: 0,
      cities: 2,
      ownedTiles: 5_500,
      reserveRatio: 0.7,
      incomingFronts: 0,
      hostileFronts: 1,
      activeNationWars: 0,
      unconnectedPorts: 0,
    };
    const stalled = shouldFundFirstPressureFactory({
      ...base,
      noGrowthTicks: 320,
    });
    const moving = shouldFundFirstPressureFactory({
      ...base,
      noGrowthTicks: 120,
    });
    expect(stalled).toBe(true);
    expect(moving).toBe(false);
    expect(
      wasm.openfront_ai_should_fund_first_pressure_factory(
        base.factories,
        base.cities,
        base.ownedTiles,
        base.reserveRatio,
        base.incomingFronts,
        base.hostileFronts,
        base.activeNationWars,
        320,
        base.unconnectedPorts,
      ) !== 0,
    ).toBe(stalled);
  });

  it("deploys deep safe capital into compounding rail instead of banking", async () => {
    const wasm = await loadWasm();
    const context: EconomicSystemContext = {
      gold: 4_000_000,
      incomePerMinute: 100_000,
      reserveRatio: 0.82,
      incomingTroopRatio: 0,
      hostileFronts: 1,
      activeNationWars: 0,
      hasNeutralLand: false,
      trapped: false,
      cities: 4,
      desiredCities: 5,
      stackedCities: 3,
      factories: 0,
      productiveFactoryStops: 0,
      isolatedFactories: 0,
      ports: 1,
      factoryConnectedPorts: 0,
      unconnectedPorts: 1,
      tradePartners: 4,
      embargoedPartners: 0,
      railStops: 5,
      connectedRailStops: 1,
      defensePosts: 1,
      strategicStructures: 6,
      exposedEconomicStructures: 0,
      cityCost: 250_000,
      factoryCost: 250_000,
      portCost: 250_000,
      defensePostCost: 100_000,
    };
    const ts = planEconomicSystems(context);
    expect(ts.action).toBe("activate-rail");
    expect(ts.capitalDeploymentPressure).toBeGreaterThan(0.8);
    expect(ts.scores["activate-rail"]).toBeGreaterThan(ts.scores.bank);

    expect(wasm.openfront_ai_plan_economic_systems(...economicArgs(context))).toBe(1);
    const control = readU32Result(wasm);
    const values = readF64Result(wasm);
    expect(control[0]).toBe(ACTION_CODES[ts.action]);
    expect(values).toHaveLength(13);
    expect(values[0]).toBeCloseTo(ts.score, 10);
    expect(values[1]).toBeCloseTo(ts.scores.bank, 10);
    expect(values[2]).toBeCloseTo(ts.scores["protect-assets"], 10);
    expect(values[3]).toBeCloseTo(ts.scores["stack-capacity"], 10);
    expect(values[4]).toBeCloseTo(ts.scores["activate-rail"], 10);
    expect(values[5]).toBeCloseTo(ts.scores["extend-trade"], 10);
    expect(values[6]).toBeCloseTo(ts.risk, 12);
    expect(values[7]).toBeCloseTo(ts.goldReserveFloor, 8);
    expect(values[8]).toBeCloseTo(ts.spendableGold, 8);
    expect(values[9]).toBeCloseTo(ts.economyReturnScore, 10);
    expect(values[10]).toBeCloseTo(ts.infrastructureNeedScore, 10);
    expect(values[11]).toBeCloseTo(ts.tradeCoverageTargetRatio, 12);
    expect(values[12]).toBeCloseTo(ts.capitalDeploymentPressure, 12);
  });
});
