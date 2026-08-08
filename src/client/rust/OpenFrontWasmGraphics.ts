import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

export type RustTerrainRgb = readonly [number, number, number];

export interface RustTerrainPalette {
  ocean: RustTerrainRgb;
  sand: RustTerrainRgb;
  plains: RustTerrainRgb;
  highland: RustTerrainRgb;
  mountain: RustTerrainRgb;
}

export interface RustTerritoryDrain {
  /** `[x, y, state, ...]`, ready for TileScatterPass. */
  tilePatches: Float32Array;
  /** `[x, y, previousOwner, newOwner, ...]`, owner changes only. */
  borderChanges: Uint32Array;
  falloutTouched: boolean;
}

interface TerritoryWasmExports extends OpenFrontWasmExports {
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
  openfront_territory_renderer_queued(handle: number): number;
  openfront_territory_renderer_tile_patch_ptr(handle: number): number;
  openfront_territory_renderer_tile_patch_len(handle: number): number;
  openfront_territory_renderer_border_change_ptr(handle: number): number;
  openfront_territory_renderer_border_change_len(handle: number): number;
  openfront_territory_renderer_display_ptr(handle: number): number;
  openfront_territory_renderer_display_len(handle: number): number;
  openfront_territory_renderer_fallout_touched(handle: number): number;
}

const packRgb = (rgb: RustTerrainRgb): number =>
  (((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff)) >>> 0;

function hasTerritoryRenderer(
  wasm: OpenFrontWasmExports,
): wasm is TerritoryWasmExports {
  const exports = wasm as unknown as Record<string, unknown>;
  return (
    typeof exports.openfront_territory_renderer_create === "function" &&
    typeof exports.openfront_territory_renderer_enqueue === "function" &&
    typeof exports.openfront_territory_renderer_drain_next === "function" &&
    typeof exports.openfront_territory_renderer_tile_patch_ptr === "function"
  );
}

/** Persistent Wasm-side territory delta scheduler and display-state mirror. */
export class OpenFrontWasmTerritoryQueue {
  private handle: number;
  private readonly tileCount: number;

  constructor(
    private readonly wasm: TerritoryWasmExports,
    private readonly width: number,
    private readonly height: number,
    bucketCount: number,
    initialState: Uint16Array,
  ) {
    this.tileCount = width * height;
    if (!Number.isSafeInteger(this.tileCount) || this.tileCount < 0) {
      throw new Error("Unable to create Rust territory queue: invalid dimensions");
    }
    if (initialState.length !== this.tileCount) {
      throw new Error(
        `Unable to create Rust territory queue: expected ${this.tileCount} states, got ${initialState.length}`,
      );
    }

    const upload = this.uploadState(initialState);
    try {
      this.handle = this.wasm.openfront_territory_renderer_create(
        width,
        height,
        Math.max(1, bucketCount | 0),
        upload,
      );
      if (this.handle === 0) this.throwLastError("create Rust territory queue");
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
  }

  replaceState(state: Uint16Array): void {
    if (state.length !== this.tileCount) {
      throw new Error(
        `Unable to replace Rust territory state: expected ${this.tileCount} states, got ${state.length}`,
      );
    }
    const upload = this.uploadState(state);
    try {
      if (this.wasm.openfront_territory_renderer_replace(this.handle, upload) === 0) {
        this.throwLastError("replace Rust territory state");
      }
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
  }

  /**
   * Copy only changed refs + their newest values into Wasm. Duplicate refs stay
   * coalesced in Rust until their drip bucket drains.
   */
  enqueue(tileState: Uint16Array, changedTiles: readonly number[]): number {
    if (changedTiles.length === 0) return 0;
    if (tileState.length !== this.tileCount) {
      throw new Error(
        `Unable to enqueue Rust territory delta: expected ${this.tileCount} states, got ${tileState.length}`,
      );
    }

    const upload = this.wasm.openfront_upload_create(changedTiles.length * 8);
    if (upload === 0) this.throwLastError("allocate Rust territory delta upload");
    try {
      const ptr = this.wasm.openfront_upload_ptr(upload);
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("locate Rust territory delta upload");
      }
      const words = new Uint32Array(
        this.wasm.memory.buffer,
        ptr,
        changedTiles.length * 2,
      );
      let count = 0;
      for (let i = 0; i < changedTiles.length; i++) {
        const ref = changedTiles[i];
        if (!Number.isInteger(ref) || ref < 0 || ref >= this.tileCount) continue;
        const offset = count * 2;
        words[offset] = ref >>> 0;
        words[offset + 1] = tileState[ref] >>> 0;
        count++;
      }
      if (count === 0) return 0;

      const queued = this.wasm.openfront_territory_renderer_enqueue(
        this.handle,
        upload,
        count,
      );
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("enqueue Rust territory delta");
      }
      return queued >>> 0;
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
  }

  drainNext(): RustTerritoryDrain {
    this.wasm.openfront_territory_renderer_drain_next(this.handle);
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("drain Rust territory bucket");
    }
    return this.snapshotDrain();
  }

  drainAll(): RustTerritoryDrain {
    this.wasm.openfront_territory_renderer_drain_all(this.handle);
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("drain all Rust territory buckets");
    }
    return this.snapshotDrain();
  }

  clear(): void {
    if (this.wasm.openfront_territory_renderer_clear(this.handle) === 0) {
      this.throwLastError("clear Rust territory queue");
    }
  }

  get queued(): number {
    const queued = this.wasm.openfront_territory_renderer_queued(this.handle) >>> 0;
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("read Rust territory queue length");
    }
    return queued;
  }

  displayState(): Uint16Array {
    const len = this.wasm.openfront_territory_renderer_display_len(this.handle) >>> 0;
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("read Rust territory display-state length");
    }
    if (len !== this.tileCount) {
      throw new Error(
        `Unable to read Rust territory display state: expected ${this.tileCount} states, got ${len}`,
      );
    }
    const ptr = this.wasm.openfront_territory_renderer_display_ptr(this.handle) >>> 0;
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("locate Rust territory display state");
    }
    return new Uint16Array(this.wasm.memory.buffer, ptr, len);
  }

  dispose(): void {
    if (this.handle === 0) return;
    this.wasm.openfront_territory_renderer_destroy(this.handle);
    this.handle = 0;
  }

  private snapshotDrain(): RustTerritoryDrain {
    const tileLen =
      this.wasm.openfront_territory_renderer_tile_patch_len(this.handle) >>> 0;
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("read Rust territory patch length");
    }
    const tilePtr = tileLen
      ? this.wasm.openfront_territory_renderer_tile_patch_ptr(this.handle) >>> 0
      : 0;
    if (tileLen && this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("locate Rust territory patches");
    }

    const borderLen =
      this.wasm.openfront_territory_renderer_border_change_len(this.handle) >>> 0;
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("read Rust territory border-change length");
    }
    const borderPtr = borderLen
      ? this.wasm.openfront_territory_renderer_border_change_ptr(this.handle) >>> 0
      : 0;
    if (borderLen && this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("locate Rust territory border changes");
    }

    const falloutTouched =
      this.wasm.openfront_territory_renderer_fallout_touched(this.handle) !== 0;
    if (this.wasm.openfront_last_error() !== 0) {
      this.throwLastError("read Rust territory fallout state");
    }

    return {
      tilePatches: tileLen
        ? new Float32Array(this.wasm.memory.buffer, tilePtr, tileLen)
        : new Float32Array(0),
      borderChanges: borderLen
        ? new Uint32Array(this.wasm.memory.buffer, borderPtr, borderLen)
        : new Uint32Array(0),
      falloutTouched,
    };
  }

  private uploadState(state: Uint16Array): number {
    const upload = this.wasm.openfront_upload_create(state.byteLength);
    if (upload === 0) this.throwLastError("allocate Rust territory state upload");
    const ptr = this.wasm.openfront_upload_ptr(upload);
    if (this.wasm.openfront_last_error() !== 0) {
      this.wasm.openfront_upload_destroy(upload);
      this.throwLastError("locate Rust territory state upload");
    }
    new Uint8Array(this.wasm.memory.buffer, ptr, state.byteLength).set(
      new Uint8Array(state.buffer, state.byteOffset, state.byteLength),
    );
    return upload;
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

/**
 * Small main-thread Wasm facade for renderer-side bulk buffer preparation.
 * It intentionally owns a separate Wasm instance from the simulation worker:
 * browser workers cannot share an ordinary WebAssembly.Memory, and graphics
 * must stay on the thread that owns WebGL.
 */
export class OpenFrontWasmGraphics {
  private static currentInstance: OpenFrontWasmGraphics | null = null;

  private constructor(private readonly wasm: OpenFrontWasmExports) {
    const exportedVersion = this.wasm.openfront_abi_version() >>> 0;
    if (exportedVersion !== ABI_VERSION) {
      throw new Error(
        `OpenFront graphics Wasm ABI mismatch: expected version ${ABI_VERSION}, got ${exportedVersion}`,
      );
    }
    const exportedInvalid = this.wasm.openfront_invalid_result() >>> 0;
    if (exportedInvalid !== INVALID_RESULT) {
      throw new Error(
        `OpenFront graphics Wasm ABI mismatch: expected invalid sentinel ${INVALID_RESULT}, got ${exportedInvalid}`,
      );
    }
    if (typeof this.wasm.openfront_graphics_terrain_rgba !== "function") {
      throw new Error("OpenFront graphics Wasm is missing terrain RGBA support");
    }
  }

  static current(): OpenFrontWasmGraphics | null {
    return OpenFrontWasmGraphics.currentInstance;
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmGraphics> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront graphics Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    const graphics = new OpenFrontWasmGraphics(
      source.instance.exports as OpenFrontWasmExports,
    );
    OpenFrontWasmGraphics.currentInstance = graphics;
    return graphics;
  }

  createTerritoryQueue(
    width: number,
    height: number,
    bucketCount: number,
    initialState: Uint16Array,
  ): OpenFrontWasmTerritoryQueue | null {
    if (!hasTerritoryRenderer(this.wasm)) return null;
    return new OpenFrontWasmTerritoryQueue(
      this.wasm,
      width,
      height,
      bucketCount,
      initialState,
    );
  }

  buildTerrainRGBA(
    terrainBytes: Uint8Array,
    width: number,
    height: number,
    palette: RustTerrainPalette,
  ): Uint8Array {
    const expectedPixels = width * height;
    if (!Number.isSafeInteger(expectedPixels) || expectedPixels < 0) {
      throw new Error("Unable to build Rust terrain texture: invalid dimensions");
    }
    if (terrainBytes.length !== expectedPixels) {
      throw new Error(
        `Unable to build Rust terrain texture: expected ${expectedPixels} terrain bytes, got ${terrainBytes.length}`,
      );
    }

    const upload = this.wasm.openfront_upload_create(terrainBytes.byteLength);
    if (upload === 0) this.throwLastError("allocate terrain upload buffer");
    try {
      const inputPtr = this.wasm.openfront_upload_ptr(upload);
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("locate terrain upload buffer");
      }
      new Uint8Array(
        this.wasm.memory.buffer,
        inputPtr,
        terrainBytes.byteLength,
      ).set(terrainBytes);

      const output = this.wasm.openfront_graphics_terrain_rgba(
        upload,
        width,
        height,
        packRgb(palette.ocean),
        packRgb(palette.sand),
        packRgb(palette.plains),
        packRgb(palette.highland),
        packRgb(palette.mountain),
      );
      if (output === 0) this.throwLastError("build terrain RGBA texture");
      if (output !== upload) {
        throw new Error(
          `Unable to build Rust terrain texture: encoder returned unexpected buffer ${output}`,
        );
      }

      const outputLen = this.wasm.openfront_upload_len(upload) >>> 0;
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("read terrain RGBA length");
      }
      const expectedBytes = expectedPixels * 4;
      if (outputLen !== expectedBytes) {
        throw new Error(
          `Unable to build Rust terrain texture: expected ${expectedBytes} RGBA bytes, got ${outputLen}`,
        );
      }
      const outputPtr = this.wasm.openfront_upload_ptr(upload);
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("locate terrain RGBA buffer");
      }
      return new Uint8Array(
        new Uint8Array(this.wasm.memory.buffer, outputPtr, outputLen),
      );
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
