import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

const COALITION_HELPER_RECORD_BYTES = 24;
const OPPONENT_RECORD_BYTES = 24;
const MIN_RECORD_CAPACITY = 16;

export type RustStrategicAction =
  | "defend"
  | "strike"
  | "naval"
  | "expand"
  | "attack"
  | "infrastructure";

const STRATEGIC_ACTIONS: readonly RustStrategicAction[] = [
  "defend",
  "strike",
  "naval",
  "expand",
  "attack",
  "infrastructure",
];

export interface RustAiCoalitionHelper {
  readonly reliability: number;
  readonly reserveRatio: number;
  readonly canReach: boolean;
  readonly treatyBlocked: boolean;
}

export interface RustAiCoalitionEvaluation {
  readonly score: number;
  readonly offensiveCostMultiplier: number;
  readonly helperStates: Uint32Array;
  readonly availableHelpers: number;
  readonly treatyBlockedHelpers: number;
}

export interface RustAiOpponentInput {
  readonly troops: number;
  readonly maxTroops: number;
  readonly tiles: number;
  readonly ownTiles: number;
  readonly incomingAttacks: number;
  readonly outgoingAttacks: number;
  readonly silos: number;
  readonly warships: number;
  readonly previousTiles: number;
  readonly previousTroops: number;
  readonly elapsedTicks: number;
  readonly predictedChoice?: string;
  readonly forecastThreat: number;
}

export interface RustAiOpponentMetrics {
  readonly troopRatio: number;
  readonly territoryRatio: number;
  readonly territoryGrowthRate: number;
  readonly troopGrowthRate: number;
  readonly growthPressure: number;
  readonly militaryPressure: number;
  readonly siloCount: number;
  readonly navalPressure: number;
}

export interface RustAiStrategicOpponent {
  readonly militaryPressure: number;
  readonly growthPressure: number;
  readonly siloCount: number;
}

export interface RustAiStrategicPlanInput {
  readonly reserveRatio: number;
  readonly incomingFronts: number;
  readonly incomingTroops: number;
  readonly maxTroops: number;
  readonly hasNeutralLand: boolean;
  readonly hostileBorders: number;
  readonly activeNationWars: number;
  readonly navalThreats: number;
  readonly tradeTargets: number;
  readonly navalPressureRatio?: number;
  readonly tradeOpportunityRatio?: number;
  readonly readyStrategicSlots: number;
  readonly affordableStrategicWeapons: number;
  readonly actionableStrikeTargets: number;
  readonly opponents: readonly RustAiStrategicOpponent[];
}

export interface RustAiStrategicPlanResult {
  readonly action: RustStrategicAction;
  readonly score: number;
  readonly scores: Readonly<Record<RustStrategicAction, number>>;
  readonly strongestOpponentIndex: number | undefined;
  readonly criticalDefense: boolean;
  readonly incomingTroopRatio: number;
}

/**
 * Synchronous strategic-AI facade after the shared Wasm module is loaded.
 * Reusable upload buffers keep target scoring cheap enough to call every AI
 * planning cycle rather than treating Rust as an occasional batch job.
 */
export class OpenFrontWasmAi {
  private helperUpload = 0;
  private helperUploadPtr = 0;
  private helperCapacity = 0;
  private opponentUpload = 0;
  private opponentUploadPtr = 0;
  private opponentCapacity = 0;

  private constructor(private readonly wasm: OpenFrontWasmExports) {
    const exportedVersion = this.wasm.openfront_abi_version() >>> 0;
    if (exportedVersion !== ABI_VERSION) {
      throw new Error(
        `OpenFront AI Wasm ABI mismatch: expected version ${ABI_VERSION}, got ${exportedVersion}`,
      );
    }
    if ((this.wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront AI Wasm invalid-result sentinel mismatch");
    }
    if (
      typeof this.wasm.openfront_ai_coalition_target_evaluate !== "function" ||
      typeof this.wasm.openfront_ai_model_opponent !== "function" ||
      typeof this.wasm.openfront_ai_plan_strategic_action !== "function" ||
      typeof this.wasm.openfront_result_f64_ptr !== "function" ||
      typeof this.wasm.openfront_result_f64_len !== "function"
    ) {
      throw new Error("OpenFront Wasm is missing strategic AI support");
    }
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmAi> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront AI Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmAi(source.instance.exports as OpenFrontWasmExports);
  }

  evaluateCoalitionTarget(
    basePriority: number,
    enemyActiveWars: number,
    helpers: readonly RustAiCoalitionHelper[],
  ): RustAiCoalitionEvaluation {
    this.ensureHelperCapacity(Math.max(1, helpers.length));
    const view = new DataView(
      this.wasm.memory.buffer,
      this.helperUploadPtr,
      this.helperCapacity * COALITION_HELPER_RECORD_BYTES,
    );
    for (let index = 0; index < helpers.length; index++) {
      const helper = helpers[index]!;
      const offset = index * COALITION_HELPER_RECORD_BYTES;
      view.setFloat64(offset, helper.reliability, true);
      view.setFloat64(offset + 8, helper.reserveRatio, true);
      view.setUint32(offset + 16, helper.canReach ? 1 : 0, true);
      view.setUint32(offset + 20, helper.treatyBlocked ? 1 : 0, true);
    }

    if (
      this.wasm.openfront_ai_coalition_target_evaluate(
        basePriority,
        enemyActiveWars >>> 0,
        this.helperUpload,
        helpers.length,
      ) === 0
    ) {
      this.throwLastError("evaluate coalition target");
    }

    const summary = this.readF64Result(2, "read coalition target evaluation");
    const states = this.readU32Result(
      helpers.length + 2,
      "read coalition helper states",
    );
    return {
      score: summary[0]!,
      offensiveCostMultiplier: summary[1]!,
      availableHelpers: states[0]!,
      treatyBlockedHelpers: states[1]!,
      helperStates: states.slice(2),
    };
  }

  modelOpponent(input: RustAiOpponentInput): RustAiOpponentMetrics {
    if (
      this.wasm.openfront_ai_model_opponent(
        input.troops,
        input.maxTroops,
        input.tiles,
        input.ownTiles,
        input.incomingAttacks >>> 0,
        input.outgoingAttacks >>> 0,
        input.silos >>> 0,
        input.warships >>> 0,
        input.previousTiles,
        input.previousTroops,
        input.elapsedTicks,
        encodePredictedChoice(input.predictedChoice),
        input.forecastThreat,
      ) === 0
    ) {
      this.throwLastError("model opponent");
    }
    const result = this.readF64Result(8, "read opponent model");
    return {
      troopRatio: result[0]!,
      territoryRatio: result[1]!,
      territoryGrowthRate: result[2]!,
      troopGrowthRate: result[3]!,
      growthPressure: result[4]!,
      militaryPressure: result[5]!,
      siloCount: result[6]!,
      navalPressure: result[7]!,
    };
  }

  planStrategicAction(
    input: RustAiStrategicPlanInput,
  ): RustAiStrategicPlanResult {
    this.ensureOpponentCapacity(Math.max(1, input.opponents.length));
    const view = new DataView(
      this.wasm.memory.buffer,
      this.opponentUploadPtr,
      this.opponentCapacity * OPPONENT_RECORD_BYTES,
    );
    for (let index = 0; index < input.opponents.length; index++) {
      const opponent = input.opponents[index]!;
      const offset = index * OPPONENT_RECORD_BYTES;
      view.setFloat64(offset, opponent.militaryPressure, true);
      view.setFloat64(offset + 8, opponent.growthPressure, true);
      view.setFloat64(offset + 16, opponent.siloCount, true);
    }

    if (
      this.wasm.openfront_ai_plan_strategic_action(
        input.reserveRatio,
        input.incomingFronts >>> 0,
        input.incomingTroops,
        input.maxTroops,
        input.hasNeutralLand ? 1 : 0,
        input.hostileBorders >>> 0,
        input.activeNationWars >>> 0,
        input.navalThreats >>> 0,
        input.tradeTargets >>> 0,
        input.navalPressureRatio ?? Number.NaN,
        input.tradeOpportunityRatio ?? 0,
        input.readyStrategicSlots >>> 0,
        input.affordableStrategicWeapons >>> 0,
        input.actionableStrikeTargets >>> 0,
        this.opponentUpload,
        input.opponents.length,
      ) === 0
    ) {
      this.throwLastError("plan strategic AI action");
    }

    const control = this.readU32Result(3, "read strategic AI action");
    const values = this.readF64Result(7, "read strategic AI scores");
    const action = STRATEGIC_ACTIONS[control[0]!] ?? "defend";
    const scores = Object.fromEntries(
      STRATEGIC_ACTIONS.map((candidate, index) => [candidate, values[index]!]),
    ) as Record<RustStrategicAction, number>;
    const strongestRaw = control[1]! >>> 0;
    return {
      action,
      score: scores[action],
      scores,
      strongestOpponentIndex:
        strongestRaw === INVALID_RESULT ? undefined : strongestRaw,
      criticalDefense: control[2] !== 0,
      incomingTroopRatio: values[6]!,
    };
  }

  private ensureHelperCapacity(required: number): void {
    if (this.helperUpload !== 0 && this.helperCapacity >= required) return;
    if (this.helperUpload !== 0) {
      this.wasm.openfront_upload_destroy(this.helperUpload);
    }
    this.helperCapacity = nextCapacity(required);
    this.helperUpload = this.wasm.openfront_upload_create(
      this.helperCapacity * COALITION_HELPER_RECORD_BYTES,
    );
    if (this.helperUpload === 0) this.throwLastError("allocate AI helper upload");
    this.helperUploadPtr = this.wasm.openfront_upload_ptr(this.helperUpload) >>> 0;
    if (this.helperUploadPtr === 0) this.throwLastError("locate AI helper upload");
  }

  private ensureOpponentCapacity(required: number): void {
    if (this.opponentUpload !== 0 && this.opponentCapacity >= required) return;
    if (this.opponentUpload !== 0) {
      this.wasm.openfront_upload_destroy(this.opponentUpload);
    }
    this.opponentCapacity = nextCapacity(required);
    this.opponentUpload = this.wasm.openfront_upload_create(
      this.opponentCapacity * OPPONENT_RECORD_BYTES,
    );
    if (this.opponentUpload === 0) {
      this.throwLastError("allocate AI opponent upload");
    }
    this.opponentUploadPtr =
      this.wasm.openfront_upload_ptr(this.opponentUpload) >>> 0;
    if (this.opponentUploadPtr === 0) {
      this.throwLastError("locate AI opponent upload");
    }
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

function nextCapacity(required: number): number {
  let capacity = MIN_RECORD_CAPACITY;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function encodePredictedChoice(choice: string | undefined): number {
  switch (choice) {
    case "expand":
      return 1;
    case "economy":
      return 2;
    case "attack":
      return 3;
    default:
      return 0;
  }
}

let rustAi: OpenFrontWasmAi | null = null;
let rustAiLoad: Promise<void> | null = null;
let rustAiDisabled = false;
let rustAiFailureLogged = false;

export function preloadRustAi(): Promise<void> {
  if (rustAi !== null || rustAiDisabled) return Promise.resolve();
  if (rustAiLoad !== null) return rustAiLoad;

  rustAiLoad = OpenFrontWasmAi.load(assetUrl("wasm/openfront_wasm.wasm"))
    .then((ai) => {
      rustAi = ai;
    })
    .catch((error: unknown) => {
      rustAiDisabled = true;
      logRustAiFailure(error);
    });
  return rustAiLoad;
}

export function evaluateCoalitionTargetRust(
  basePriority: number,
  enemyActiveWars: number,
  helpers: readonly RustAiCoalitionHelper[],
): RustAiCoalitionEvaluation | null {
  if (rustAi === null || rustAiDisabled) return null;
  try {
    return rustAi.evaluateCoalitionTarget(
      basePriority,
      enemyActiveWars,
      helpers,
    );
  } catch (error) {
    disableRustAi(error);
    return null;
  }
}

export function modelOpponentRust(
  input: RustAiOpponentInput,
): RustAiOpponentMetrics | null {
  if (rustAi === null || rustAiDisabled) return null;
  try {
    return rustAi.modelOpponent(input);
  } catch (error) {
    disableRustAi(error);
    return null;
  }
}

export function planStrategicActionRust(
  input: RustAiStrategicPlanInput,
): RustAiStrategicPlanResult | null {
  if (rustAi === null || rustAiDisabled) return null;
  try {
    return rustAi.planStrategicAction(input);
  } catch (error) {
    disableRustAi(error);
    return null;
  }
}

function disableRustAi(error: unknown): void {
  rustAi = null;
  rustAiDisabled = true;
  logRustAiFailure(error);
}

function logRustAiFailure(error: unknown): void {
  if (rustAiFailureLogged) return;
  rustAiFailureLogged = true;
  console.warn("Rust strategic AI disabled; using TypeScript fallback", error);
}
