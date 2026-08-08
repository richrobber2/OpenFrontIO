import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export type RustOpponentChoice =
  | "attack"
  | "defend"
  | "expand"
  | "bank"
  | "economy"
  | "naval";

const OPPONENT_CHOICES: readonly RustOpponentChoice[] = [
  "attack",
  "defend",
  "expand",
  "bank",
  "economy",
  "naval",
];

export interface RustForecastObservation {
  tick: number;
  troops: number;
  maxTroops: number;
  tiles: number;
  gold: number;
  incomingAttacks: number;
  incomingTroops: number;
  outgoingAttacks: number;
  outgoingTroops: number;
  cities: number;
  factories: number;
  ports: number;
  silos: number;
  warships: number;
  allied: boolean;
  sharesBorder: boolean;
}

export interface RustOpponentProjection {
  tick: number;
  troops: number;
  tiles: number;
  reserveRatio: number;
}

export interface RustOpponentForecastResult {
  observedChoice: RustOpponentChoice;
  predictedChoice: RustOpponentChoice;
  probabilities: Record<RustOpponentChoice, number>;
  confidence: number;
  threat: number;
  projected: {
    near: RustOpponentProjection;
    far: RustOpponentProjection;
  };
}

export interface RustOpponentForecastInput {
  current: RustForecastObservation;
  previous?: RustForecastObservation;
  previousForecast?: {
    predictedChoice: RustOpponentChoice;
    confidence: number;
  };
  ownTroops: number;
  ownMaxTroops: number;
  ownTiles: number;
}

type ForecastWasmExports = OpenFrontWasmExports & {
  openfront_ai_infer_opponent_choice(
    currentTiles: number,
    currentIncomingAttacks: number,
    currentIncomingTroops: number,
    currentOutgoingAttacks: number,
    currentOutgoingTroops: number,
    currentCities: number,
    currentFactories: number,
    currentPorts: number,
    currentSilos: number,
    currentWarships: number,
    hasPrevious: number,
    previousTiles: number,
    previousOutgoingTroops: number,
    previousCities: number,
    previousFactories: number,
    previousPorts: number,
    previousSilos: number,
    previousWarships: number,
  ): number;
  openfront_ai_forecast_opponent(
    currentTick: number,
    currentTroops: number,
    currentMaxTroops: number,
    currentTiles: number,
    currentGold: number,
    currentIncomingAttacks: number,
    currentIncomingTroops: number,
    currentOutgoingAttacks: number,
    currentOutgoingTroops: number,
    currentCities: number,
    currentFactories: number,
    currentPorts: number,
    currentSilos: number,
    currentWarships: number,
    currentAllied: number,
    currentSharesBorder: number,
    hasPrevious: number,
    previousTick: number,
    previousTroops: number,
    previousMaxTroops: number,
    previousTiles: number,
    previousGold: number,
    previousIncomingAttacks: number,
    previousIncomingTroops: number,
    previousOutgoingAttacks: number,
    previousOutgoingTroops: number,
    previousCities: number,
    previousFactories: number,
    previousPorts: number,
    previousSilos: number,
    previousWarships: number,
    hasPreviousForecast: number,
    previousForecastChoice: number,
    previousForecastConfidence: number,
    ownTroops: number,
    ownMaxTroops: number,
    ownTiles: number,
  ): number;
};

class OpenFrontWasmForecastAi {
  private constructor(private readonly wasm: ForecastWasmExports) {
    if ((this.wasm.openfront_abi_version() >>> 0) !== ABI_VERSION) {
      throw new Error("OpenFront forecast AI Wasm ABI mismatch");
    }
    if ((this.wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront forecast AI Wasm invalid-result sentinel mismatch");
    }
    for (const name of [
      "openfront_ai_infer_opponent_choice",
      "openfront_ai_forecast_opponent",
    ] as const) {
      if (typeof this.wasm[name] !== "function") {
        throw new Error(`OpenFront Wasm is missing opponent forecast export ${name}`);
      }
    }
  }

  static async load(): Promise<OpenFrontWasmForecastAi> {
    const response = await fetch(assetUrl("wasm/openfront_wasm.wasm"));
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront forecast AI Wasm: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmForecastAi(
      source.instance.exports as ForecastWasmExports,
    );
  }

  inferChoice(
    current: RustForecastObservation,
    previous?: RustForecastObservation,
  ): RustOpponentChoice {
    const result = this.wasm.openfront_ai_infer_opponent_choice(
      current.tiles,
      current.incomingAttacks,
      current.incomingTroops,
      current.outgoingAttacks,
      current.outgoingTroops,
      current.cities,
      current.factories,
      current.ports,
      current.silos,
      current.warships,
      previous === undefined ? 0 : 1,
      previous?.tiles ?? 0,
      previous?.outgoingTroops ?? 0,
      previous?.cities ?? 0,
      previous?.factories ?? 0,
      previous?.ports ?? 0,
      previous?.silos ?? 0,
      previous?.warships ?? 0,
    );
    return decodeChoice(result >>> 0);
  }

  forecast(input: RustOpponentForecastInput): RustOpponentForecastResult {
    const current = input.current;
    const previous = input.previous;
    const previousForecast = input.previousForecast;
    if (
      this.wasm.openfront_ai_forecast_opponent(
        current.tick,
        current.troops,
        current.maxTroops,
        current.tiles,
        current.gold,
        current.incomingAttacks,
        current.incomingTroops,
        current.outgoingAttacks,
        current.outgoingTroops,
        current.cities,
        current.factories,
        current.ports,
        current.silos,
        current.warships,
        current.allied ? 1 : 0,
        current.sharesBorder ? 1 : 0,
        previous === undefined ? 0 : 1,
        previous?.tick ?? 0,
        previous?.troops ?? 0,
        previous?.maxTroops ?? 0,
        previous?.tiles ?? 0,
        previous?.gold ?? 0,
        previous?.incomingAttacks ?? 0,
        previous?.incomingTroops ?? 0,
        previous?.outgoingAttacks ?? 0,
        previous?.outgoingTroops ?? 0,
        previous?.cities ?? 0,
        previous?.factories ?? 0,
        previous?.ports ?? 0,
        previous?.silos ?? 0,
        previous?.warships ?? 0,
        previousForecast === undefined ? 0 : 1,
        encodeChoice(previousForecast?.predictedChoice),
        previousForecast?.confidence ?? 0,
        input.ownTroops,
        input.ownMaxTroops,
        input.ownTiles,
      ) === 0
    ) {
      this.throwLastError("forecast opponent");
    }

    const control = this.readU32Result(2, "read opponent forecast choices");
    const values = this.readF64Result(16, "read opponent forecast values");
    const probabilities = Object.fromEntries(
      OPPONENT_CHOICES.map((choice, index) => [choice, values[index]!]),
    ) as Record<RustOpponentChoice, number>;
    return {
      observedChoice: decodeChoice(control[0]!),
      predictedChoice: decodeChoice(control[1]!),
      probabilities,
      confidence: values[6]!,
      threat: values[7]!,
      projected: {
        near: {
          tick: values[8]!,
          troops: values[9]!,
          tiles: values[10]!,
          reserveRatio: values[11]!,
        },
        far: {
          tick: values[12]!,
          troops: values[13]!,
          tiles: values[14]!,
          reserveRatio: values[15]!,
        },
      },
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

function encodeChoice(choice: RustOpponentChoice | undefined): number {
  return choice === undefined ? 3 : OPPONENT_CHOICES.indexOf(choice);
}

function decodeChoice(code: number): RustOpponentChoice {
  return OPPONENT_CHOICES[code] ?? "bank";
}

let rustForecastAi: OpenFrontWasmForecastAi | null = null;
let rustForecastAiLoad: Promise<void> | null = null;
let rustForecastAiDisabled = false;
let rustForecastAiFailureLogged = false;

export function preloadRustForecastAi(): Promise<void> {
  if (rustForecastAi !== null || rustForecastAiDisabled) {
    return Promise.resolve();
  }
  if (rustForecastAiLoad !== null) return rustForecastAiLoad;
  rustForecastAiLoad = OpenFrontWasmForecastAi.load()
    .then((ai) => {
      rustForecastAi = ai;
    })
    .catch((error: unknown) => {
      rustForecastAiDisabled = true;
      logRustForecastAiFailure(error);
    });
  return rustForecastAiLoad;
}

function useRustForecastAi<T>(
  operation: (ai: OpenFrontWasmForecastAi) => T,
): T | null {
  if (rustForecastAi === null || rustForecastAiDisabled) return null;
  try {
    return operation(rustForecastAi);
  } catch (error) {
    rustForecastAi = null;
    rustForecastAiDisabled = true;
    logRustForecastAiFailure(error);
    return null;
  }
}

export function inferOpponentChoiceRust(
  current: RustForecastObservation,
  previous?: RustForecastObservation,
): RustOpponentChoice | null {
  return useRustForecastAi((ai) => ai.inferChoice(current, previous));
}

export function forecastOpponentRust(
  input: RustOpponentForecastInput,
): RustOpponentForecastResult | null {
  return useRustForecastAi((ai) => ai.forecast(input));
}

function logRustForecastAiFailure(error: unknown): void {
  if (rustForecastAiFailureLogged) return;
  rustForecastAiFailureLogged = true;
  console.warn("Rust opponent forecasts disabled; using TypeScript fallback", error);
}
