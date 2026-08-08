import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

type TerritoryRenderExports = OpenFrontWasmExports & {
  openfront_territory_renderer_create(
    width: number,
    height: number,
    bucketCount: number,
    stateUpload: number,
  ): number;
  openfront_territory_renderer_destroy(handle: number): number;
  openfront_territory_renderer_replace(handle: number, stateUpload: number): number;
  openfront_territory_renderer_enqueue(
    handle: number,
    updateUpload: number,
    count: number,
  ): number;
  openfront_territory_renderer_drain_next(handle: number): number;
  openfront_territory_renderer_drain_all(handle: number): number;
  openfront_territory_renderer_clear(handle: number): number;
  openfront_territory_renderer_tile_patch_ptr(handle: number): number;
  openfront_territory_renderer_tile_patch_len(handle: number): number;
  openfront_territory_renderer_border_change_ptr(handle: number): number;
  openfront_territory_renderer_border_change_len(handle: number): number;
  openfront_territory_renderer_display_ptr(handle: number): number;
  openfront_territory_renderer_display_len(handle: number): number;
  openfront_territory_renderer_fallout_touched(handle: number): number;
};

const UPDATE_WORDS = 2;
const MIN_UPDATE_CAPACITY = 256;

export interface RustTerritoryDrain {
  readonly drained: number;
  /** Flat [x, y, state] triples. Borrowed until the next queue mutation. */
  readonly tilePatches: Float32Array;
  /** Flat [x, y, previousOwner, newOwner] quads. Borrowed until mutation. */
  readonly borderChanges: Uint32Array;
  readonly falloutTouched: boolean;
}

export class RustTerritoryRenderQueue {
  private updateUpload = 0;
  private updatePtr = 0;
  private updateCapacity = 0;
  private disposed = false;

  constructor(
    private readonly wasm: TerritoryRenderExports,
    private readonly handle: number,
  ) {}

  replace(state: Uint16Array): void {
    this.assertLive();
    const upload = this.uploadU16(state);
    try {
      if (this.wasm.openfront_territory_renderer_replace(this.handle, upload) === 0) {
        this.throwLastError("replace territory render state");
      }
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
  }

  enqueue(tileState: Uint16Array, changedTiles: readonly number[]): void {
    this.assertLive();
    if (changedTiles.length === 0) return;
    this.ensureUpdateCapacity(changedTiles.length);

    const words = new Uint32Array(
      this.wasm.memory.buffer,
      this.updatePtr,
      this.updateCapacity * UPDATE_WORDS,
    );
    let count = 0;
    for (let i = 0; i < changedTiles.length; i++) {
      const rawRef = changedTiles[i];
      if (
        !Number.isInteger(rawRef) ||
        rawRef < 0 ||
        rawRef >= tileState.length
      ) {
        continue;
      }
      const ref = rawRef >>> 0;
      const off = count * UPDATE_WORDS;
      words[off] = ref;
      words[off + 1] = tileState[ref];
      count++;
    }
    if (count === 0) return;

    this.wasm.openfront_territory_renderer_enqueue(
      this.handle,
      this.updateUpload,
      count,
    );
    this.throwIfLastError("queue territory render deltas");
  }

  drainNext(): RustTerritoryDrain {
    this.assertLive();
    const drained = this.wasm.openfront_territory_renderer_drain_next(this.handle) >>> 0;
    this.throwIfLastError("drain territory render bucket");
    return this.readDrain(drained);
  }

  drainAll(): RustTerritoryDrain {
    this.assertLive();
    const drained = this.wasm.openfront_territory_renderer_drain_all(this.handle) >>> 0;
    this.throwIfLastError("drain all territory render buckets");
    return this.readDrain(drained);
  }

  clear(): void {
    this.assertLive();
    if (this.wasm.openfront_territory_renderer_clear(this.handle) === 0) {
      this.throwLastError("clear territory render queue");
    }
  }

  /** Borrow the display-side tile state directly from Wasm linear memory. */
  displayState(): Uint16Array {
    this.assertLive();
    const len = this.wasm.openfront_territory_renderer_display_len(this.handle) >>> 0;
    this.throwIfLastError("read territory display-state length");
    if (len === 0) return new Uint16Array(0);
    const ptr = this.wasm.openfront_territory_renderer_display_ptr(this.handle) >>> 0;
    this.throwIfLastError("locate territory display state");
    return new Uint16Array(this.wasm.memory.buffer, ptr, len);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.updateUpload !== 0) {
      this.wasm.openfront_upload_destroy(this.updateUpload);
      this.updateUpload = 0;
    }
    this.wasm.openfront_territory_renderer_destroy(this.handle);
  }

  private readDrain(drained: number): RustTerritoryDrain {
    const tilePatchLen =
      this.wasm.openfront_territory_renderer_tile_patch_len(this.handle) >>> 0;
    this.throwIfLastError("read territory tile patch length");
    const tilePatchPtr =
      this.wasm.openfront_territory_renderer_tile_patch_ptr(this.handle) >>> 0;
    this.throwIfLastError("locate territory tile patches");

    const borderLen =
      this.wasm.openfront_territory_renderer_border_change_len(this.handle) >>> 0;
    this.throwIfLastError("read territory border change length");
    const borderPtr =
      this.wasm.openfront_territory_renderer_border_change_ptr(this.handle) >>> 0;
    this.throwIfLastError("locate territory border changes");

    const falloutTouched =
      this.wasm.openfront_territory_renderer_fallout_touched(this.handle) !== 0;
    this.throwIfLastError("read territory fallout change flag");

    return {
      drained,
      tilePatches:
        tilePatchLen === 0
          ? new Float32Array(0)
          : new Float32Array(this.wasm.memory.buffer, tilePatchPtr, tilePatchLen),
      borderChanges:
        borderLen === 0
          ? new Uint32Array(0)
          : new Uint32Array(this.wasm.memory.buffer, borderPtr, borderLen),
      falloutTouched,
    };
  }

  private uploadU16(values: Uint16Array): number {
    const upload = this.wasm.openfront_upload_create(values.byteLength);
    if (upload === 0) this.throwLastError("allocate territory state upload");
    const ptr = this.wasm.openfront_upload_ptr(upload) >>> 0;
    this.throwIfLastError("locate territory state upload");
    new Uint16Array(this.wasm.memory.buffer, ptr, values.length).set(values);
    return upload;
  }

  private ensureUpdateCapacity(required: number): void {
    if (this.updateUpload !== 0 && this.updateCapacity >= required) return;
    if (this.updateUpload !== 0) {
      this.wasm.openfront_upload_destroy(this.updateUpload);
      this.updateUpload = 0;
    }

    let capacity = Math.max(MIN_UPDATE_CAPACITY, this.updateCapacity || 0);
    while (capacity < required) capacity *= 2;
    const upload = this.wasm.openfront_upload_create(
      capacity * UPDATE_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    );
    if (upload === 0) this.throwLastError("allocate territory delta upload");
    const ptr = this.wasm.openfront_upload_ptr(upload) >>> 0;
    this.throwIfLastError("locate territory delta upload");
    this.updateUpload = upload;
    this.updatePtr = ptr;
    this.updateCapacity = capacity;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Rust territory render queue is disposed");
  }

  private throwIfLastError(operation: string): void {
    if ((this.wasm.openfront_last_error() >>> 0) === 0) return;
    this.throwLastError(operation);
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

class OpenFrontWasmTerritoryRender {
  private constructor(private readonly wasm: TerritoryRenderExports) {
    if ((wasm.openfront_abi_version() >>> 0) !== ABI_VERSION) {
      throw new Error("OpenFront territory renderer Wasm ABI mismatch");
    }
    if ((wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront territory renderer invalid-result mismatch");
    }
    if (typeof wasm.openfront_territory_renderer_create !== "function") {
      throw new Error("OpenFront Wasm is missing territory render staging support");
    }
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmTerritoryRender> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront territory renderer Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmTerritoryRender(
      source.instance.exports as TerritoryRenderExports,
    );
  }

  createQueue(
    width: number,
    height: number,
    bucketCount: number,
    initialState: Uint16Array,
  ): RustTerritoryRenderQueue {
    const upload = this.wasm.openfront_upload_create(initialState.byteLength);
    if (upload === 0) this.throwLastError("allocate initial territory state");
    try {
      const ptr = this.wasm.openfront_upload_ptr(upload) >>> 0;
      this.throwIfLastError("locate initial territory state");
      new Uint16Array(this.wasm.memory.buffer, ptr, initialState.length).set(
        initialState,
      );
      const handle = this.wasm.openfront_territory_renderer_create(
        width,
        height,
        bucketCount,
        upload,
      );
      if (handle === 0) this.throwLastError("create territory render queue");
      return new RustTerritoryRenderQueue(this.wasm, handle);
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
  }

  private throwIfLastError(operation: string): void {
    if ((this.wasm.openfront_last_error() >>> 0) === 0) return;
    this.throwLastError(operation);
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

let territoryRenderer: OpenFrontWasmTerritoryRender | null = null;
let preloadPromise: Promise<void> | null = null;
let failureLogged = false;

export function preloadRustTerritoryRenderer(): Promise<void> {
  if (territoryRenderer !== null) return Promise.resolve();
  if (preloadPromise !== null) return preloadPromise;

  preloadPromise = OpenFrontWasmTerritoryRender.load(
    assetUrl("wasm/openfront_wasm.wasm"),
  )
    .then((renderer) => {
      territoryRenderer = renderer;
    })
    .catch((error: unknown) => {
      if (!failureLogged) {
        failureLogged = true;
        console.warn(
          "Rust territory render staging unavailable; using TypeScript fallback",
          error,
        );
      }
    });
  return preloadPromise;
}

export function createRustTerritoryRenderQueue(
  width: number,
  height: number,
  bucketCount: number,
  initialState: Uint16Array,
): RustTerritoryRenderQueue | null {
  if (territoryRenderer === null) return null;
  try {
    return territoryRenderer.createQueue(width, height, bucketCount, initialState);
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      console.warn(
        "Rust territory render queue failed; using TypeScript fallback",
        error,
      );
    }
    return null;
  }
}
