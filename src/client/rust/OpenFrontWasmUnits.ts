import { assetUrl } from "../../core/AssetUrls";
import { UnitType } from "../../core/game/Game";
import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export const UNIT_CLASS_MOBILE = 1 << 0;
export const UNIT_CLASS_STRUCTURE = 1 << 1;
export const UNIT_CLASS_TRAIL = 1 << 2;
export const UNIT_CLASS_NUKE_ACTIVE = 1 << 3;
export const UNIT_CLASS_NUKE_TELEGRAPH = 1 << 4;
export const UNIT_CLASS_ATTACK_RING = 1 << 5;
export const UNIT_CLASS_LIGHT = 1 << 6;

const WORDS_PER_RECORD = 3;
const BYTES_PER_RECORD = WORDS_PER_RECORD * Uint32Array.BYTES_PER_ELEMENT;
const MIN_CAPACITY = 32;
const UNKNOWN_KIND = 0xffff_ffff;
const EMPTY_RESULT = new Uint32Array(0);

const HOST_IS_LITTLE_ENDIAN = (() => {
  const word = new Uint32Array([0x01020304]);
  return new Uint8Array(word.buffer)[0] === 0x04;
})();

// Stable serialization order. Keep in lockstep with Rust UnitKind.
const UNIT_KIND_BY_TYPE: ReadonlyMap<string, number> = new Map([
  [UnitType.TransportShip, 0],
  [UnitType.TradeShip, 1],
  [UnitType.Warship, 2],
  [UnitType.AtomBomb, 3],
  [UnitType.HydrogenBomb, 4],
  [UnitType.MIRV, 5],
  [UnitType.SAMMissile, 6],
  [UnitType.Shell, 7],
  [UnitType.MIRVWarhead, 8],
  [UnitType.City, 9],
  [UnitType.Port, 10],
  [UnitType.Factory, 11],
  [UnitType.DefensePost, 12],
  [UnitType.SAMLauncher, 13],
  [UnitType.MissileSilo, 14],
  [UnitType.Train, 15],
]);

export interface UnitClassificationInput {
  readonly id: number;
  readonly unitType: string;
  readonly isActive: boolean;
}

/**
 * Main-thread Wasm facade for classifying unit deltas in batches.
 *
 * The upload allocation is retained and grows geometrically. Each tick writes
 * only changed unit triples `[id, kind, active]`; Rust overwrites the final word
 * with category flags. The returned view is borrowed and must be consumed
 * before the next classify call.
 */
export class OpenFrontWasmUnits {
  private uploadHandle = 0;
  private uploadPtr = 0;
  private capacityRecords = 0;

  private constructor(private readonly wasm: OpenFrontWasmExports) {
    const exportedVersion = this.wasm.openfront_abi_version() >>> 0;
    if (exportedVersion !== ABI_VERSION) {
      throw new Error(
        `OpenFront units Wasm ABI mismatch: expected version ${ABI_VERSION}, got ${exportedVersion}`,
      );
    }
    const exportedInvalid = this.wasm.openfront_invalid_result() >>> 0;
    if (exportedInvalid !== INVALID_RESULT) {
      throw new Error(
        `OpenFront units Wasm ABI mismatch: expected invalid sentinel ${INVALID_RESULT}, got ${exportedInvalid}`,
      );
    }
    if (typeof this.wasm.openfront_units_classify !== "function") {
      throw new Error("OpenFront units Wasm is missing unit classification support");
    }
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmUnits> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront units Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmUnits(
      source.instance.exports as OpenFrontWasmExports,
    );
  }

  classify(updates: readonly UnitClassificationInput[]): Uint32Array {
    const count = updates.length;
    if (count === 0) return EMPTY_RESULT;
    this.ensureCapacity(count);

    if (HOST_IS_LITTLE_ENDIAN) {
      const words = new Uint32Array(
        this.wasm.memory.buffer,
        this.uploadPtr,
        this.capacityRecords * WORDS_PER_RECORD,
      );
      for (let index = 0; index < count; index++) {
        const update = updates[index]!;
        const offset = index * WORDS_PER_RECORD;
        words[offset] = update.id >>> 0;
        words[offset + 1] = UNIT_KIND_BY_TYPE.get(update.unitType) ?? UNKNOWN_KIND;
        words[offset + 2] = update.isActive ? 1 : 0;
      }
      this.runClassification(count);
      return words.subarray(0, count * WORDS_PER_RECORD);
    }

    const bytes = new DataView(
      this.wasm.memory.buffer,
      this.uploadPtr,
      this.capacityRecords * BYTES_PER_RECORD,
    );
    for (let index = 0; index < count; index++) {
      const update = updates[index]!;
      const offset = index * BYTES_PER_RECORD;
      bytes.setUint32(offset, update.id >>> 0, true);
      bytes.setUint32(
        offset + 4,
        UNIT_KIND_BY_TYPE.get(update.unitType) ?? UNKNOWN_KIND,
        true,
      );
      bytes.setUint32(offset + 8, update.isActive ? 1 : 0, true);
    }
    this.runClassification(count);

    const result = new Uint32Array(count * WORDS_PER_RECORD);
    for (let index = 0; index < result.length; index++) {
      result[index] = bytes.getUint32(index * 4, true);
    }
    return result;
  }

  dispose(): void {
    if (this.uploadHandle !== 0) {
      this.wasm.openfront_upload_destroy(this.uploadHandle);
      this.uploadHandle = 0;
      this.uploadPtr = 0;
      this.capacityRecords = 0;
    }
  }

  private ensureCapacity(requiredRecords: number): void {
    if (this.uploadHandle !== 0 && this.capacityRecords >= requiredRecords) return;

    if (this.uploadHandle !== 0) {
      this.wasm.openfront_upload_destroy(this.uploadHandle);
      this.uploadHandle = 0;
    }

    let capacity = Math.max(MIN_CAPACITY, this.capacityRecords || MIN_CAPACITY);
    while (capacity < requiredRecords) capacity *= 2;
    const byteLength = capacity * BYTES_PER_RECORD;
    const handle = this.wasm.openfront_upload_create(byteLength);
    if (handle === 0) this.throwLastError("allocate unit classification buffer");
    const pointer = this.wasm.openfront_upload_ptr(handle);
    if (this.wasm.openfront_last_error() !== 0) {
      this.wasm.openfront_upload_destroy(handle);
      this.throwLastError("locate unit classification buffer");
    }

    this.uploadHandle = handle;
    this.uploadPtr = pointer;
    this.capacityRecords = capacity;
  }

  private runClassification(count: number): void {
    if (this.wasm.openfront_units_classify(this.uploadHandle, count) === 0) {
      this.throwLastError("classify unit deltas");
    }
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

let rustUnits: OpenFrontWasmUnits | null = null;
let rustUnitsLoad: Promise<void> | null = null;
let rustUnitsFailureLogged = false;

/** Preload the Rust unit classifier; failures leave the caller free to fall back. */
export function preloadRustUnitClassifier(): Promise<void> {
  if (rustUnits !== null) return Promise.resolve();
  if (rustUnitsLoad !== null) return rustUnitsLoad;

  rustUnitsLoad = OpenFrontWasmUnits.load(assetUrl("wasm/openfront_wasm.wasm"))
    .then((units) => {
      rustUnits = units;
    })
    .catch((error: unknown) => {
      if (!rustUnitsFailureLogged) {
        rustUnitsFailureLogged = true;
        console.warn(
          "Rust unit classifier unavailable; using TypeScript fallback",
          error,
        );
      }
    });
  return rustUnitsLoad;
}

/** Return borrowed `[id, kind, flags]` triples, or null when Rust is unavailable. */
export function classifyUnitDeltasRust(
  updates: readonly UnitClassificationInput[],
): Uint32Array | null {
  if (rustUnits === null) return null;
  try {
    return rustUnits.classify(updates);
  } catch (error) {
    rustUnits.dispose();
    rustUnits = null;
    if (!rustUnitsFailureLogged) {
      rustUnitsFailureLogged = true;
      console.warn(
        "Rust unit classifier failed; using TypeScript fallback",
        error,
      );
    }
    return null;
  }
}
