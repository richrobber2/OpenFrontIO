import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export type RustEconomicSystemAction =
  | "bank"
  | "protect-assets"
  | "stack-capacity"
  | "activate-rail"
  | "extend-trade";

const ECONOMIC_ACTIONS: readonly RustEconomicSystemAction[] = [
  "bank",
  "protect-assets",
  "stack-capacity",
  "activate-rail",
  "extend-trade",
];

export interface RustCityStackPlacementScore {
  score: number;
  nearbyCities: number;
  nearestCityDistance: number | null;
  stacked: boolean;
}

export interface RustFactoryPlacementInput {
  ownCities: number;
  ownPorts: number;
  externalCities: number;
  externalPorts: number;
  factoryCorridorConnections: number;
  overlappingRailroads: number;
  ghostPathLengths: readonly number[];
  railBends: number;
  depth: number;
  safestDepth: number;
  nearestFactoryDistance?: number;
  minimumRange: number;
  maximumRange: number;
}

export interface RustFactoryPlacementScore {
  score: number;
  productiveStops: number;
  railEfficiency: number;
  railReuseScore: number;
}

export interface RustCapacityEscapeCityBudgetInput {
  gold: number;
  protectedSpendableGold: number;
  cityCost: number;
  cities: number;
  desiredCities: number;
  requiredTroops: number;
  maxTroops: number;
  incomingFronts: number;
  hostileFronts?: number;
  activeNationWars?: number;
  reserveRatio?: number;
}

export interface RustPressureFactoryInput {
  factories: number;
  cities: number;
  ownedTiles: number;
  reserveRatio: number;
  incomingFronts: number;
  hostileFronts: number;
  activeNationWars: number;
  noGrowthTicks: number;
  unconnectedPorts: number;
}

export interface RustEconomicSystemContext {
  gold: number;
  incomePerMinute: number;
  reserveRatio: number;
  incomingTroopRatio: number;
  hostileFronts: number;
  activeNationWars: number;
  hasNeutralLand: boolean;
  trapped: boolean;
  cities: number;
  desiredCities: number;
  stackedCities: number;
  factories: number;
  productiveFactoryStops: number;
  isolatedFactories: number;
  ports: number;
  factoryConnectedPorts?: number;
  unconnectedPorts?: number;
  tradePartners: number;
  embargoedPartners: number;
  railStops: number;
  connectedRailStops: number;
  defensePosts: number;
  strategicStructures: number;
  exposedEconomicStructures: number;
  cityCost: number;
  factoryCost: number;
  portCost: number;
  defensePostCost: number;
}

export interface RustEconomicSystemPlan {
  action: RustEconomicSystemAction;
  score: number;
  scores: Record<RustEconomicSystemAction, number>;
  risk: number;
  goldReserveFloor: number;
  spendableGold: number;
  economyReturnScore: number;
  infrastructureNeedScore: number;
  tradeCoverageTargetRatio: number;
  capitalDeploymentPressure: number;
}

type EconomyWasmExports = OpenFrontWasmExports & {
  openfront_ai_rail_city_growth_score(
    railConnections: number,
    overlappingRailroads: number,
  ): number;
  openfront_ai_score_city_stack_placement(
    hasNearestCity: number,
    nearestCityDistance: number,
    nearbyCities: number,
    structureMinDistance: number,
  ): number;
  openfront_ai_score_factory_placement(
    ownCities: number,
    ownPorts: number,
    externalCities: number,
    externalPorts: number,
    factoryCorridorConnections: number,
    overlappingRailroads: number,
    pathTiles: number,
    routeCount: number,
    railBends: number,
    depth: number,
    safestDepth: number,
    hasNearestFactory: number,
    nearestFactoryDistance: number,
    minimumRange: number,
    maximumRange: number,
  ): number;
  openfront_ai_estimate_trade_route_gold(
    distance: number,
    shortRangeDebuff: number,
  ): number;
  openfront_ai_capacity_escape_city_budget(
    gold: number,
    protectedSpendableGold: number,
    cityCost: number,
    cities: number,
    desiredCities: number,
    requiredTroops: number,
    maxTroops: number,
    incomingFronts: number,
    hostileFronts: number,
    activeNationWars: number,
    reserveRatio: number,
  ): number;
  openfront_ai_should_fund_first_pressure_factory(
    factories: number,
    cities: number,
    ownedTiles: number,
    reserveRatio: number,
    incomingFronts: number,
    hostileFronts: number,
    activeNationWars: number,
    noGrowthTicks: number,
    unconnectedPorts: number,
  ): number;
  openfront_ai_plan_economic_systems(
    gold: number,
    incomePerMinute: number,
    reserveRatio: number,
    incomingTroopRatio: number,
    hostileFronts: number,
    activeNationWars: number,
    hasNeutralLand: number,
    trapped: number,
    cities: number,
    desiredCities: number,
    stackedCities: number,
    factories: number,
    productiveFactoryStops: number,
    isolatedFactories: number,
    ports: number,
    factoryConnectedPorts: number,
    unconnectedPorts: number,
    tradePartners: number,
    embargoedPartners: number,
    railStops: number,
    connectedRailStops: number,
    defensePosts: number,
    strategicStructures: number,
    exposedEconomicStructures: number,
    cityCost: number,
    factoryCost: number,
    portCost: number,
    defensePostCost: number,
  ): number;
};

class OpenFrontWasmEconomyAi {
  private constructor(private readonly wasm: EconomyWasmExports) {
    if ((this.wasm.openfront_abi_version() >>> 0) !== ABI_VERSION) {
      throw new Error("OpenFront economy AI Wasm ABI mismatch");
    }
    if ((this.wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront economy AI Wasm invalid-result sentinel mismatch");
    }
    for (const name of [
      "openfront_ai_rail_city_growth_score",
      "openfront_ai_score_city_stack_placement",
      "openfront_ai_score_factory_placement",
      "openfront_ai_estimate_trade_route_gold",
      "openfront_ai_capacity_escape_city_budget",
      "openfront_ai_should_fund_first_pressure_factory",
      "openfront_ai_plan_economic_systems",
    ] as const) {
      if (typeof this.wasm[name] !== "function") {
        throw new Error(`OpenFront Wasm is missing economy AI export ${name}`);
      }
    }
  }

  static async load(): Promise<OpenFrontWasmEconomyAi> {
    const response = await fetch(assetUrl("wasm/openfront_wasm.wasm"));
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront economy AI Wasm: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmEconomyAi(source.instance.exports as EconomyWasmExports);
  }

  railCityGrowthScore(railConnections: number, overlappingRailroads: number): number {
    return this.wasm.openfront_ai_rail_city_growth_score(
      railConnections >>> 0,
      overlappingRailroads >>> 0,
    );
  }

  scoreCityStackPlacement(
    cityDistancesSquared: readonly number[],
    structureMinDistance: number,
  ): RustCityStackPlacementScore {
    const minimum = Math.max(1, structureMinDistance);
    const distances = cityDistancesSquared
      .filter((distance) => Number.isFinite(distance) && distance >= 0)
      .map((distance) => Math.sqrt(distance))
      .sort((a, b) => a - b);
    const nearest = distances[0] ?? null;
    const nearbyCities = distances.filter(
      (distance) => distance <= minimum * 2.25,
    ).length;
    if (
      this.wasm.openfront_ai_score_city_stack_placement(
        nearest === null ? 0 : 1,
        nearest ?? 0,
        nearbyCities >>> 0,
        structureMinDistance,
      ) === 0
    ) {
      this.throwLastError("score city stack placement");
    }
    const control = this.readU32Result(3, "read city stack placement state");
    const values = this.readF64Result(2, "read city stack placement score");
    return {
      score: values[0]!,
      nearbyCities: control[0]!,
      nearestCityDistance: control[2] === 0 ? null : values[1]!,
      stacked: control[1] !== 0,
    };
  }

  scoreFactoryPlacement(input: RustFactoryPlacementInput): RustFactoryPlacementScore {
    const pathTiles = input.ghostPathLengths.reduce(
      (sum, length) => sum + Math.max(0, length),
      0,
    );
    const routeCount =
      input.ghostPathLengths.filter((length) => length > 0).length +
      (input.overlappingRailroads > 0 ? 1 : 0);
    if (
      this.wasm.openfront_ai_score_factory_placement(
        input.ownCities,
        input.ownPorts,
        input.externalCities,
        input.externalPorts,
        input.factoryCorridorConnections,
        input.overlappingRailroads,
        pathTiles,
        routeCount,
        input.railBends,
        input.depth,
        input.safestDepth,
        input.nearestFactoryDistance === undefined ? 0 : 1,
        input.nearestFactoryDistance ?? 0,
        input.minimumRange,
        input.maximumRange,
      ) === 0
    ) {
      this.throwLastError("score factory placement");
    }
    const values = this.readF64Result(4, "read factory placement score");
    return {
      score: values[0]!,
      productiveStops: values[1]!,
      railEfficiency: values[2]!,
      railReuseScore: values[3]!,
    };
  }

  estimateTradeRouteGold(distance: number, shortRangeDebuff: number): number {
    return this.wasm.openfront_ai_estimate_trade_route_gold(
      distance,
      shortRangeDebuff,
    );
  }

  capacityEscapeCityBudget(input: RustCapacityEscapeCityBudgetInput): {
    spendableGold: number;
    bypassBank: boolean;
  } {
    if (
      this.wasm.openfront_ai_capacity_escape_city_budget(
        input.gold,
        input.protectedSpendableGold,
        input.cityCost,
        input.cities,
        input.desiredCities,
        input.requiredTroops,
        input.maxTroops,
        input.incomingFronts,
        input.hostileFronts ?? 0,
        input.activeNationWars ?? 0,
        input.reserveRatio ?? 0,
      ) === 0
    ) {
      this.throwLastError("plan capacity escape city budget");
    }
    const control = this.readU32Result(1, "read city budget state");
    const values = this.readF64Result(1, "read city budget value");
    return { spendableGold: values[0]!, bypassBank: control[0] !== 0 };
  }

  shouldFundFirstPressureFactory(input: RustPressureFactoryInput): boolean {
    return (
      this.wasm.openfront_ai_should_fund_first_pressure_factory(
        input.factories,
        input.cities,
        input.ownedTiles,
        input.reserveRatio,
        input.incomingFronts,
        input.hostileFronts,
        input.activeNationWars,
        input.noGrowthTicks,
        input.unconnectedPorts,
      ) !== 0
    );
  }

  planEconomicSystems(context: RustEconomicSystemContext): RustEconomicSystemPlan {
    const factoryConnectedPorts = Math.max(0, context.factoryConnectedPorts ?? 0);
    const unconnectedPorts = Math.max(
      0,
      context.unconnectedPorts ?? Math.max(0, context.ports - factoryConnectedPorts),
    );
    if (
      this.wasm.openfront_ai_plan_economic_systems(
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
      ) === 0
    ) {
      this.throwLastError("plan economic systems");
    }
    const control = this.readU32Result(1, "read economic system action");
    const values = this.readF64Result(13, "read economic system plan");
    const action = ECONOMIC_ACTIONS[control[0]!] ?? "bank";
    const scores = Object.fromEntries(
      ECONOMIC_ACTIONS.map((name, index) => [name, values[index + 1]!]),
    ) as Record<RustEconomicSystemAction, number>;
    return {
      action,
      score: values[0]!,
      scores,
      risk: values[6]!,
      goldReserveFloor: values[7]!,
      spendableGold: values[8]!,
      economyReturnScore: values[9]!,
      infrastructureNeedScore: values[10]!,
      tradeCoverageTargetRatio: values[11]!,
      capitalDeploymentPressure: values[12]!,
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

let rustEconomyAi: OpenFrontWasmEconomyAi | null = null;
let rustEconomyAiLoad: Promise<void> | null = null;
let rustEconomyAiDisabled = false;
let rustEconomyAiFailureLogged = false;

export function preloadRustEconomyAi(): Promise<void> {
  if (rustEconomyAi !== null || rustEconomyAiDisabled) return Promise.resolve();
  if (rustEconomyAiLoad !== null) return rustEconomyAiLoad;
  rustEconomyAiLoad = OpenFrontWasmEconomyAi.load()
    .then((ai) => {
      rustEconomyAi = ai;
    })
    .catch((error: unknown) => {
      rustEconomyAiDisabled = true;
      logRustEconomyAiFailure(error);
    });
  return rustEconomyAiLoad;
}

function useRustEconomyAi<T>(
  operation: (ai: OpenFrontWasmEconomyAi) => T,
): T | null {
  if (rustEconomyAi === null || rustEconomyAiDisabled) return null;
  try {
    return operation(rustEconomyAi);
  } catch (error) {
    rustEconomyAi = null;
    rustEconomyAiDisabled = true;
    logRustEconomyAiFailure(error);
    return null;
  }
}

export function railCityGrowthScoreRust(
  railConnections: number,
  overlappingRailroads: number,
): number | null {
  return useRustEconomyAi((ai) =>
    ai.railCityGrowthScore(railConnections, overlappingRailroads),
  );
}

export function scoreCityStackPlacementRust(
  cityDistancesSquared: readonly number[],
  structureMinDistance: number,
): RustCityStackPlacementScore | null {
  return useRustEconomyAi((ai) =>
    ai.scoreCityStackPlacement(cityDistancesSquared, structureMinDistance),
  );
}

export function scoreFactoryPlacementRust(
  input: RustFactoryPlacementInput,
): RustFactoryPlacementScore | null {
  return useRustEconomyAi((ai) => ai.scoreFactoryPlacement(input));
}

export function estimateTradeRouteGoldRust(
  distance: number,
  shortRangeDebuff = 300,
): number | null {
  return useRustEconomyAi((ai) =>
    ai.estimateTradeRouteGold(distance, shortRangeDebuff),
  );
}

export function capacityEscapeCityBudgetRust(
  input: RustCapacityEscapeCityBudgetInput,
): { spendableGold: number; bypassBank: boolean } | null {
  return useRustEconomyAi((ai) => ai.capacityEscapeCityBudget(input));
}

export function shouldFundFirstPressureFactoryRust(
  input: RustPressureFactoryInput,
): boolean | null {
  return useRustEconomyAi((ai) => ai.shouldFundFirstPressureFactory(input));
}

export function planEconomicSystemsRust(
  context: RustEconomicSystemContext,
): RustEconomicSystemPlan | null {
  return useRustEconomyAi((ai) => ai.planEconomicSystems(context));
}

function logRustEconomyAiFailure(error: unknown): void {
  if (rustEconomyAiFailureLogged) return;
  rustEconomyAiFailureLogged = true;
  console.warn("Rust economy AI disabled; using TypeScript fallback", error);
}
