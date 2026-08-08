import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export interface RustPurchaseQueueCandidate {
  index: number;
  group?: number;
  cost: number;
  value: number;
  returnRatio: number;
  synergy: number;
}

export interface RustPurchaseQueueContext {
  spendCap: number;
  minimumPurchases: number;
  maximumPurchases: number;
  risk: number;
  capitalPressure: number;
  candidates: readonly RustPurchaseQueueCandidate[];
}

export interface RustPurchaseQueuePlan {
  selectedIndices: number[];
  totalCost: number;
  totalScore: number;
  remainingBudget: number;
}

type PurchaseQueueWasmExports = OpenFrontWasmExports & {
  openfront_ai_select_purchase_queue(
    spendCap: number,
    minimumPurchases: number,
    maximumPurchases: number,
    risk: number,
    capitalPressure: number,
    uploadHandle: number,
    count: number,
  ): number;
};

class OpenFrontWasmPurchaseQueueAi {
  private constructor(private readonly wasm: PurchaseQueueWasmExports) {
    if ((this.wasm.openfront_abi_version() >>> 0) !== ABI_VERSION) {
      throw new Error("OpenFront purchase queue Wasm ABI mismatch");
    }
    if ((this.wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront purchase queue Wasm invalid-result sentinel mismatch");
    }
    if (typeof this.wasm.openfront_ai_select_purchase_queue !== "function") {
      throw new Error("OpenFront Wasm is missing purchase queue export");
    }
  }

  static async load(): Promise<OpenFrontWasmPurchaseQueueAi> {
    const response = await fetch(assetUrl("wasm/openfront_wasm.wasm"));
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront purchase queue Wasm: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmPurchaseQueueAi(
      source.instance.exports as PurchaseQueueWasmExports,
    );
  }

  select(context: RustPurchaseQueueContext): RustPurchaseQueuePlan {
    const recordBytes = 40;
    const byteLength = context.candidates.length * recordBytes;
    const upload = this.wasm.openfront_upload_create(byteLength) >>> 0;
    if (upload === 0) this.throwLastError("allocate purchase queue upload");
    try {
      const pointer = this.wasm.openfront_upload_ptr(upload) >>> 0;
      if (byteLength > 0 && pointer === 0) {
        this.throwLastError("map purchase queue upload");
      }
      const view = new DataView(this.wasm.memory.buffer, pointer, byteLength);
      context.candidates.forEach((candidate, index) => {
        const offset = index * recordBytes;
        view.setUint32(offset, candidate.index >>> 0, true);
        view.setUint32(offset + 4, (candidate.group ?? 0) >>> 0, true);
        view.setFloat64(offset + 8, candidate.cost, true);
        view.setFloat64(offset + 16, candidate.value, true);
        view.setFloat64(offset + 24, candidate.returnRatio, true);
        view.setFloat64(offset + 32, candidate.synergy, true);
      });
      if (
        this.wasm.openfront_ai_select_purchase_queue(
          context.spendCap,
          context.minimumPurchases >>> 0,
          context.maximumPurchases >>> 0,
          context.risk,
          context.capitalPressure,
          upload,
          context.candidates.length >>> 0,
        ) === 0
      ) {
        this.throwLastError("select purchase queue");
      }
      const length = this.wasm.openfront_result_len() >>> 0;
      const pointerResult = this.wasm.openfront_result_ptr() >>> 0;
      const selectedIndices = Array.from(
        new Uint32Array(this.wasm.memory.buffer, pointerResult, length),
      );
      const f64Length = this.wasm.openfront_result_f64_len() >>> 0;
      if (f64Length !== 3) {
        throw new Error(
          `read purchase queue totals: expected 3 lanes, got ${f64Length}`,
        );
      }
      const f64Pointer = this.wasm.openfront_result_f64_ptr() >>> 0;
      const values = new Float64Array(
        new Float64Array(this.wasm.memory.buffer, f64Pointer, f64Length),
      );
      return {
        selectedIndices,
        totalCost: values[0]!,
        totalScore: values[1]!,
        remainingBudget: values[2]!,
      };
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

let rustPurchaseQueueAi: OpenFrontWasmPurchaseQueueAi | null = null;
let rustPurchaseQueueAiLoad: Promise<void> | null = null;
let rustPurchaseQueueAiDisabled = false;
let rustPurchaseQueueAiFailureLogged = false;

export function preloadRustPurchaseQueueAi(): Promise<void> {
  if (rustPurchaseQueueAi !== null || rustPurchaseQueueAiDisabled) {
    return Promise.resolve();
  }
  if (rustPurchaseQueueAiLoad !== null) return rustPurchaseQueueAiLoad;
  rustPurchaseQueueAiLoad = OpenFrontWasmPurchaseQueueAi.load()
    .then((ai) => {
      rustPurchaseQueueAi = ai;
    })
    .catch((error: unknown) => {
      rustPurchaseQueueAiDisabled = true;
      logFailure(error);
    });
  return rustPurchaseQueueAiLoad;
}

export function selectPurchaseQueueRust(
  context: RustPurchaseQueueContext,
): RustPurchaseQueuePlan | null {
  if (rustPurchaseQueueAi === null || rustPurchaseQueueAiDisabled) return null;
  try {
    return rustPurchaseQueueAi.select(context);
  } catch (error) {
    rustPurchaseQueueAi = null;
    rustPurchaseQueueAiDisabled = true;
    logFailure(error);
    return null;
  }
}

function logFailure(error: unknown): void {
  if (rustPurchaseQueueAiFailureLogged) return;
  rustPurchaseQueueAiFailureLogged = true;
  console.warn("Rust purchase queue disabled; using TypeScript fallback", error);
}
