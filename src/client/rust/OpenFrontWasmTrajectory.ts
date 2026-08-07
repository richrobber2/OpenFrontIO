import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

const SAM_RECORD_BYTES = 3 * Float64Array.BYTES_PER_ELEMENT;
const TRAJECTORY_RESULT_VALUES = 11;
const MIN_SAM_CAPACITY = 8;

export interface RustNukeTrajectorySAM {
  readonly x: number;
  readonly y: number;
  readonly rangeSq: number;
}

export interface RustNukeTrajectoryData {
  readonly p0x: number;
  readonly p0y: number;
  readonly p1x: number;
  readonly p1y: number;
  readonly p2x: number;
  readonly p2y: number;
  readonly p3x: number;
  readonly p3y: number;
  readonly tUntargetableStart: number;
  readonly tUntargetableEnd: number;
  readonly tSamIntercept: number;
}

/**
 * Small synchronous facade for renderer trajectory math once the Wasm module
 * has been loaded. The SAM upload allocation is retained and grows
 * geometrically because trajectory previews can update every pointer move.
 */
export class OpenFrontWasmTrajectory {
  private samUploadHandle = 0;
  private samUploadPtr = 0;
  private samCapacity = 0;

  private constructor(private readonly wasm: OpenFrontWasmExports) {
    const exportedVersion = this.wasm.openfront_abi_version() >>> 0;
    if (exportedVersion !== ABI_VERSION) {
      throw new Error(
        `OpenFront trajectory Wasm ABI mismatch: expected version ${ABI_VERSION}, got ${exportedVersion}`,
      );
    }
    const exportedInvalid = this.wasm.openfront_invalid_result() >>> 0;
    if (exportedInvalid !== INVALID_RESULT) {
      throw new Error(
        `OpenFront trajectory Wasm ABI mismatch: expected invalid sentinel ${INVALID_RESULT}, got ${exportedInvalid}`,
      );
    }
    if (
      typeof this.wasm.openfront_nuke_trajectory_build !== "function" ||
      typeof this.wasm.openfront_result_f64_ptr !== "function" ||
      typeof this.wasm.openfront_result_f64_len !== "function"
    ) {
      throw new Error("OpenFront trajectory Wasm is missing nuke trajectory support");
    }
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmTrajectory> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront trajectory Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmTrajectory(
      source.instance.exports as OpenFrontWasmExports,
    );
  }

  static async fromBytes(
    bytes: Uint8Array<ArrayBufferLike>,
  ): Promise<OpenFrontWasmTrajectory> {
    const source = await WebAssembly.instantiate(new Uint8Array(bytes), {});
    return new OpenFrontWasmTrajectory(
      source.instance.exports as OpenFrontWasmExports,
    );
  }

  samRange(level: number): number {
    const range = this.wasm.openfront_nuke_sam_range(level);
    this.throwIfLastError("compute SAM range");
    return range;
  }

  build(
    srcX: number,
    srcY: number,
    dstX: number,
    dstY: number,
    mapH: number,
    directionUp: boolean,
    sams: readonly RustNukeTrajectorySAM[],
  ): RustNukeTrajectoryData {
    if (sams.length > 0) {
      this.ensureSamCapacity(sams.length);
      const view = new DataView(
        this.wasm.memory.buffer,
        this.samUploadPtr,
        this.samCapacity * SAM_RECORD_BYTES,
      );
      for (let index = 0; index < sams.length; index++) {
        const sam = sams[index]!;
        const offset = index * SAM_RECORD_BYTES;
        view.setFloat64(offset, sam.x, true);
        view.setFloat64(offset + 8, sam.y, true);
        view.setFloat64(offset + 16, sam.rangeSq, true);
      }
    }

    if (
      this.wasm.openfront_nuke_trajectory_build(
        srcX,
        srcY,
        dstX,
        dstY,
        mapH,
        directionUp ? 1 : 0,
        this.samUploadHandle,
        sams.length,
      ) === 0
    ) {
      this.throwLastError("build nuke trajectory");
    }

    const length = this.wasm.openfront_result_f64_len() >>> 0;
    if (length !== TRAJECTORY_RESULT_VALUES) {
      throw new Error(
        `Rust nuke trajectory length mismatch: expected ${TRAJECTORY_RESULT_VALUES}, got ${length}`,
      );
    }
    const pointer = this.wasm.openfront_result_f64_ptr() >>> 0;
    if (pointer === 0) {
      throw new Error("Rust nuke trajectory result pointer is null");
    }

    const result = new DataView(
      this.wasm.memory.buffer,
      pointer,
      length * Float64Array.BYTES_PER_ELEMENT,
    );
    const value = (index: number) =>
      result.getFloat64(index * Float64Array.BYTES_PER_ELEMENT, true);

    return {
      p0x: value(0),
      p0y: value(1),
      p1x: value(2),
      p1y: value(3),
      p2x: value(4),
      p2y: value(5),
      p3x: value(6),
      p3y: value(7),
      tUntargetableStart: value(8),
      tUntargetableEnd: value(9),
      tSamIntercept: value(10),
    };
  }

  dispose(): void {
    if (this.samUploadHandle === 0) return;
    this.wasm.openfront_upload_destroy(this.samUploadHandle);
    this.samUploadHandle = 0;
    this.samUploadPtr = 0;
    this.samCapacity = 0;
  }

  private ensureSamCapacity(required: number): void {
    if (this.samUploadHandle !== 0 && this.samCapacity >= required) return;

    if (this.samUploadHandle !== 0) {
      this.wasm.openfront_upload_destroy(this.samUploadHandle);
      this.samUploadHandle = 0;
    }

    let capacity = Math.max(MIN_SAM_CAPACITY, this.samCapacity || MIN_SAM_CAPACITY);
    while (capacity < required) capacity *= 2;
    const handle = this.wasm.openfront_upload_create(capacity * SAM_RECORD_BYTES);
    if (handle === 0) this.throwLastError("allocate nuke trajectory SAM buffer");
    const pointer = this.wasm.openfront_upload_ptr(handle) >>> 0;
    this.throwIfLastError("locate nuke trajectory SAM buffer");

    this.samUploadHandle = handle;
    this.samUploadPtr = pointer;
    this.samCapacity = capacity;
  }

  private throwIfLastError(operation: string): void {
    const code = this.wasm.openfront_last_error() >>> 0;
    if (code === 0) return;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

let rustTrajectory: OpenFrontWasmTrajectory | null = null;
let rustTrajectoryLoad: Promise<void> | null = null;
let rustTrajectoryDisabled = false;
let rustTrajectoryFailureLogged = false;

/** Preload renderer trajectory math; failure leaves the TypeScript fallback active. */
export function preloadRustNukeTrajectory(): Promise<void> {
  if (rustTrajectory !== null || rustTrajectoryDisabled) return Promise.resolve();
  if (rustTrajectoryLoad !== null) return rustTrajectoryLoad;

  rustTrajectoryLoad = OpenFrontWasmTrajectory.load(
    assetUrl("wasm/openfront_wasm.wasm"),
  )
    .then((trajectory) => {
      rustTrajectory = trajectory;
    })
    .catch((error: unknown) => {
      rustTrajectoryDisabled = true;
      logRustTrajectoryFailure(error);
    });
  return rustTrajectoryLoad;
}

export function samRangeRust(level: number): number | null {
  if (rustTrajectory === null || rustTrajectoryDisabled) return null;
  try {
    return rustTrajectory.samRange(level);
  } catch (error) {
    disableRustTrajectory(error);
    return null;
  }
}

export function buildNukeTrajectoryRust(
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  mapH: number,
  directionUp: boolean,
  sams: readonly RustNukeTrajectorySAM[],
): RustNukeTrajectoryData | null {
  if (rustTrajectory === null || rustTrajectoryDisabled) return null;
  try {
    return rustTrajectory.build(srcX, srcY, dstX, dstY, mapH, directionUp, sams);
  } catch (error) {
    disableRustTrajectory(error);
    return null;
  }
}

function disableRustTrajectory(error: unknown): void {
  rustTrajectory?.dispose();
  rustTrajectory = null;
  rustTrajectoryDisabled = true;
  logRustTrajectoryFailure(error);
}

function logRustTrajectoryFailure(error: unknown): void {
  if (rustTrajectoryFailureLogged) return;
  rustTrajectoryFailureLogged = true;
  console.warn("Rust nuke trajectory disabled; using TypeScript fallback", error);
}
