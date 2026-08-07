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

export const STRUCTURE_FLOATS_PER_INSTANCE = 6;

const WORDS_PER_RECORD = 3;
const BYTES_PER_RECORD = WORDS_PER_RECORD * Uint32Array.BYTES_PER_ELEMENT;
const STRUCTURE_WORDS_PER_RECORD = 7;
const STRUCTURE_BYTES_PER_RECORD =
  STRUCTURE_WORDS_PER_RECORD * Uint32Array.BYTES_PER_ELEMENT;
const MIN_CAPACITY = 32;
const UNKNOWN_KIND = 0xffff_ffff;
const EMPTY_RESULT = new Uint32Array(0);
const EMPTY_STRUCTURE_DATA = new Float32Array(0);

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

export interface StructureRenderInput extends UnitClassificationInput {
  readonly pos: number;
  readonly ownerID: number;
  readonly underConstruction?: boolean;
  readonly markedForDeletion: number | false;
}

/**
 * A copied JS-owned patch returned by Rust's persistent structure table.
 * `dirtyStart` is an instance slot, not a float index. `dirtyData` contains
 * whole 6-float instances and stays valid after later Wasm calls.
 */
export interface RustStructureRenderDelta {
  readonly instanceCount: number;
  readonly dirtyStart: number;
  readonly dirtyData: Float32Array;
}

/**
 * Main-thread Wasm facade for classifying unit deltas and maintaining the
 * persistent compact structure-instance table.
 *
 * Upload allocations are retained and grow geometrically. Unit classification
 * writes changed triples `[id, kind, active]`. Structure rendering writes only
 * changed 7-word records; Rust keeps the full render table between calls and
 * returns only the dirty packed slot range.
 */
export class OpenFrontWasmUnits {
  private uploadHandle = 0;
  private uploadPtr = 0;
  private capacityRecords = 0;

  private structureUploadHandle = 0;
  private structureUploadPtr = 0;
  private structureCapacityRecords = 0;
  private structureRendererHandle = 0;
  private structureMapWidth = 0;

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

  supportsStructureRenderer(): boolean {
    return (
      typeof this.wasm.openfront_structure_renderer_create === "function" &&
      typeof this.wasm.openfront_structure_renderer_update === "function" &&
      typeof this.wasm.openfront_structure_renderer_data_ptr === "function" &&
      typeof this.wasm.openfront_structure_renderer_dirty_start === "function" &&
      this.wasm.openfront_structure_renderer_floats_per_instance() ===
        STRUCTURE_FLOATS_PER_INSTANCE
    );
  }

  updateStructureRenderer(
    updates: readonly StructureRenderInput[],
    mapWidth: number,
  ): RustStructureRenderDelta {
    if (!this.supportsStructureRenderer()) {
      throw new Error("OpenFront units Wasm is missing structure renderer support");
    }
    if (!Number.isInteger(mapWidth) || mapWidth <= 0) {
      throw new Error(`Invalid structure render map width ${mapWidth}`);
    }

    this.ensureStructureRenderer(mapWidth);
    const count = updates.length;
    if (count > 0) {
      this.ensureStructureCapacity(count);
      this.writeStructureRecords(updates);
      if (
        this.wasm.openfront_structure_renderer_update(
          this.structureRendererHandle,
          this.structureUploadHandle,
          count,
        ) === 0
      ) {
        this.throwLastError("update structure render state");
      }
    }

    const instanceCount =
      this.wasm.openfront_structure_renderer_instance_count(
        this.structureRendererHandle,
      ) >>> 0;
    this.throwIfLastError("read structure instance count");

    const dirtyStartRaw =
      this.wasm.openfront_structure_renderer_dirty_start(
        this.structureRendererHandle,
      ) >>> 0;
    this.throwIfLastError("read structure dirty start");
    const dirtyLen =
      this.wasm.openfront_structure_renderer_dirty_len(
        this.structureRendererHandle,
      ) >>> 0;
    this.throwIfLastError("read structure dirty length");

    if (dirtyStartRaw === INVALID_RESULT || dirtyLen === 0) {
      return {
        instanceCount,
        dirtyStart: 0,
        dirtyData: EMPTY_STRUCTURE_DATA,
      };
    }

    const dataLen =
      this.wasm.openfront_structure_renderer_data_len(
        this.structureRendererHandle,
      ) >>> 0;
    this.throwIfLastError("read structure render data length");
    const expectedDataLen = instanceCount * STRUCTURE_FLOATS_PER_INSTANCE;
    if (dataLen !== expectedDataLen) {
      throw new Error(
        `Rust structure render length mismatch: expected ${expectedDataLen}, got ${dataLen}`,
      );
    }

    const ptr =
      this.wasm.openfront_structure_renderer_data_ptr(
        this.structureRendererHandle,
      ) >>> 0;
    this.throwIfLastError("locate structure render data");
    const floatStart = dirtyStartRaw * STRUCTURE_FLOATS_PER_INSTANCE;
    const floatLength = dirtyLen * STRUCTURE_FLOATS_PER_INSTANCE;
    if (floatStart + floatLength > dataLen || (floatLength > 0 && ptr === 0)) {
      throw new Error("Rust structure render dirty range is out of bounds");
    }

    // Copy only the dirty range. The Rust Vec can move on the next batch, so a
    // borrowed view cannot safely survive until the renderer uploads it.
    const dirtyData = new Float32Array(floatLength);
    dirtyData.set(
      new Float32Array(
        this.wasm.memory.buffer,
        ptr + floatStart * Float32Array.BYTES_PER_ELEMENT,
        floatLength,
      ),
    );

    return {
      instanceCount,
      dirtyStart: dirtyStartRaw,
      dirtyData,
    };
  }

  dispose(): void {
    if (this.structureRendererHandle !== 0) {
      this.wasm.openfront_structure_renderer_destroy(this.structureRendererHandle);
      this.structureRendererHandle = 0;
      this.structureMapWidth = 0;
    }
    if (this.structureUploadHandle !== 0) {
      this.wasm.openfront_upload_destroy(this.structureUploadHandle);
      this.structureUploadHandle = 0;
      this.structureUploadPtr = 0;
      this.structureCapacityRecords = 0;
    }
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

  private ensureStructureRenderer(mapWidth: number): void {
    if (
      this.structureRendererHandle !== 0 &&
      this.structureMapWidth === mapWidth
    ) {
      return;
    }
    if (this.structureRendererHandle !== 0) {
      this.wasm.openfront_structure_renderer_destroy(this.structureRendererHandle);
      this.structureRendererHandle = 0;
    }
    const handle = this.wasm.openfront_structure_renderer_create(mapWidth >>> 0);
    if (handle === 0) this.throwLastError("create structure render state");
    this.structureRendererHandle = handle;
    this.structureMapWidth = mapWidth;
  }

  private ensureStructureCapacity(requiredRecords: number): void {
    if (
      this.structureUploadHandle !== 0 &&
      this.structureCapacityRecords >= requiredRecords
    ) {
      return;
    }
    if (this.structureUploadHandle !== 0) {
      this.wasm.openfront_upload_destroy(this.structureUploadHandle);
      this.structureUploadHandle = 0;
    }

    let capacity = Math.max(
      MIN_CAPACITY,
      this.structureCapacityRecords || MIN_CAPACITY,
    );
    while (capacity < requiredRecords) capacity *= 2;
    const handle = this.wasm.openfront_upload_create(
      capacity * STRUCTURE_BYTES_PER_RECORD,
    );
    if (handle === 0) this.throwLastError("allocate structure render buffer");
    const pointer = this.wasm.openfront_upload_ptr(handle);
    if (this.wasm.openfront_last_error() !== 0) {
      this.wasm.openfront_upload_destroy(handle);
      this.throwLastError("locate structure render buffer");
    }
    this.structureUploadHandle = handle;
    this.structureUploadPtr = pointer;
    this.structureCapacityRecords = capacity;
  }

  private writeStructureRecords(
    updates: readonly StructureRenderInput[],
  ): void {
    const words = new Uint32Array(
      this.wasm.memory.buffer,
      this.structureUploadPtr,
      this.structureCapacityRecords * STRUCTURE_WORDS_PER_RECORD,
    );
    for (let index = 0; index < updates.length; index++) {
      const update = updates[index]!;
      const off = index * STRUCTURE_WORDS_PER_RECORD;
      words[off] = update.id >>> 0;
      words[off + 1] = UNIT_KIND_BY_TYPE.get(update.unitType) ?? UNKNOWN_KIND;
      words[off + 2] = update.isActive ? 1 : 0;
      words[off + 3] = update.pos >>> 0;
      words[off + 4] = update.ownerID >>> 0;
      words[off + 5] = update.underConstruction ? 1 : 0;
      words[off + 6] = update.markedForDeletion !== false ? 1 : 0;
    }
  }

  private runClassification(count: number): void {
    if (this.wasm.openfront_units_classify(this.uploadHandle, count) === 0) {
      this.throwLastError("classify unit deltas");
    }
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

let rustUnits: OpenFrontWasmUnits | null = null;
let rustUnitsLoad: Promise<void> | null = null;
let rustUnitsFailureLogged = false;
let rustStructureRendererDisabled = false;
let rustStructureRendererFailureLogged = false;

/** Preload the Rust unit classifier; failures leave the caller free to fall back. */
export function preloadRustUnitClassifier(): Promise<void> {
  if (rustUnits !== null) return Promise.resolve();
  if (rustUnitsLoad !== null) return rustUnitsLoad;

  rustUnitsLoad = OpenFrontWasmUnits.load(assetUrl("wasm/openfront_wasm.wasm"))
    .then((units) => {
      rustUnits = units;
      rustStructureRendererDisabled = !units.supportsStructureRenderer();
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

/**
 * Apply structure deltas to Rust's persistent packed instance table.
 * Returns a JS-owned dirty range, or null when the renderer ABI is unavailable.
 */
export function updateStructureRenderDeltasRust(
  updates: readonly StructureRenderInput[],
  mapWidth: number,
): RustStructureRenderDelta | null {
  if (rustUnits === null || rustStructureRendererDisabled) return null;
  try {
    return rustUnits.updateStructureRenderer(updates, mapWidth);
  } catch (error) {
    rustStructureRendererDisabled = true;
    if (!rustStructureRendererFailureLogged) {
      rustStructureRendererFailureLogged = true;
      console.warn(
        "Rust structure renderer unavailable; using TypeScript fallback",
        error,
      );
    }
    return null;
  }
}
