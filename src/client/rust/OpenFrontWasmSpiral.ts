import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export const SPIRAL_SAMPLE_FLOATS = 5;
const SPIRAL_SAMPLES_PER_TILE = 2;

export interface RustSpiralSegmentInput {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Authoritative JavaScript Math.hypot result for the segment. */
  readonly segmentLength: number;
  readonly previousDirX: number;
  readonly previousDirY: number;
  readonly hasPreviousDir: boolean;
  readonly includeStart: boolean;
  readonly headDistance: number;
}

/**
 * Synchronous facade for spiral-trail segment resampling once Wasm is loaded.
 * Returned sample arrays borrow Wasm memory and are valid until the next call.
 */
export class OpenFrontWasmSpiral {
  private constructor(private readonly wasm: OpenFrontWasmExports) {
    const exportedVersion = this.wasm.openfront_abi_version() >>> 0;
    if (exportedVersion !== ABI_VERSION) {
      throw new Error(
        `OpenFront spiral Wasm ABI mismatch: expected version ${ABI_VERSION}, got ${exportedVersion}`,
      );
    }
    const exportedInvalid = this.wasm.openfront_invalid_result() >>> 0;
    if (exportedInvalid !== INVALID_RESULT) {
      throw new Error(
        `OpenFront spiral Wasm ABI mismatch: expected invalid sentinel ${INVALID_RESULT}, got ${exportedInvalid}`,
      );
    }
    if (
      typeof this.wasm.openfront_spiral_segment_build !== "function" ||
      typeof this.wasm.openfront_result_f32_ptr !== "function" ||
      typeof this.wasm.openfront_result_f32_len !== "function"
    ) {
      throw new Error("OpenFront spiral Wasm is missing segment sampling support");
    }
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmSpiral> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront spiral Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmSpiral(source.instance.exports as OpenFrontWasmExports);
  }

  static async fromBytes(
    bytes: Uint8Array<ArrayBufferLike>,
  ): Promise<OpenFrontWasmSpiral> {
    const source = await WebAssembly.instantiate(new Uint8Array(bytes), {});
    return new OpenFrontWasmSpiral(source.instance.exports as OpenFrontWasmExports);
  }

  buildSegment(input: RustSpiralSegmentInput): Float32Array {
    const steps = Math.ceil(input.segmentLength * SPIRAL_SAMPLES_PER_TILE);
    const expectedSamples = steps + (input.includeStart ? 1 : 0);
    const expectedLength = expectedSamples * SPIRAL_SAMPLE_FLOATS;
    if (
      !Number.isFinite(input.segmentLength) ||
      input.segmentLength <= 0 ||
      !Number.isSafeInteger(expectedSamples) ||
      expectedSamples <= 0
    ) {
      throw new Error(`Invalid spiral trail segment length: ${input.segmentLength}`);
    }

    if (
      this.wasm.openfront_spiral_segment_build(
        input.x0,
        input.y0,
        input.x1,
        input.y1,
        input.segmentLength,
        input.previousDirX,
        input.previousDirY,
        input.hasPreviousDir ? 1 : 0,
        input.includeStart ? 1 : 0,
        input.headDistance,
      ) === 0
    ) {
      this.throwLastError("build spiral trail segment");
    }

    const length = this.wasm.openfront_result_f32_len() >>> 0;
    if (length !== expectedLength) {
      throw new Error(
        `Rust spiral segment length mismatch: expected ${expectedLength}, got ${length}`,
      );
    }
    const pointer = this.wasm.openfront_result_f32_ptr() >>> 0;
    if (pointer === 0) {
      throw new Error("Rust spiral segment result pointer is null");
    }
    return new Float32Array(this.wasm.memory.buffer, pointer, length);
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

let rustSpiral: OpenFrontWasmSpiral | null = null;
let rustSpiralLoad: Promise<void> | null = null;
let rustSpiralDisabled = false;
let rustSpiralFailureLogged = false;

/** Preload spiral geometry only when a spiral cosmetic is actually configured. */
export function preloadRustSpiral(): Promise<void> {
  if (rustSpiral !== null || rustSpiralDisabled) return Promise.resolve();
  if (rustSpiralLoad !== null) return rustSpiralLoad;

  rustSpiralLoad = OpenFrontWasmSpiral.load(assetUrl("wasm/openfront_wasm.wasm"))
    .then((spiral) => {
      rustSpiral = spiral;
    })
    .catch((error: unknown) => {
      rustSpiralDisabled = true;
      logRustSpiralFailure(error);
    });
  return rustSpiralLoad;
}

/** Borrow Rust's packed `[cx, cy, px, py, distance]` samples, or null to fall back. */
export function buildSpiralSegmentRust(
  input: RustSpiralSegmentInput,
): Float32Array | null {
  if (rustSpiral === null || rustSpiralDisabled) return null;
  try {
    return rustSpiral.buildSegment(input);
  } catch (error) {
    rustSpiral = null;
    rustSpiralDisabled = true;
    logRustSpiralFailure(error);
    return null;
  }
}

function logRustSpiralFailure(error: unknown): void {
  if (rustSpiralFailureLogged) return;
  rustSpiralFailureLogged = true;
  console.warn("Rust spiral trail sampling disabled; using TypeScript fallback", error);
}
