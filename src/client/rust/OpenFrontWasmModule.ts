import { OpenFrontRustMap } from "./OpenFrontRustMap";
import {
  ABI_VERSION,
  DEFAULT_WASM_URL,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

const HOST_IS_LITTLE_ENDIAN = (() => {
  const word = new Uint32Array([0x01020304]);
  return new Uint8Array(word.buffer)[0] === 0x04;
})();

export class OpenFrontWasmModule {
  private constructor(private readonly wasm: OpenFrontWasmExports) {
    const exportedVersion = this.wasm.openfront_abi_version() >>> 0;
    if (exportedVersion !== ABI_VERSION) {
      throw new Error(
        `OpenFront Wasm ABI mismatch: expected version ${ABI_VERSION}, got ${exportedVersion}`,
      );
    }

    const exportedInvalid = this.wasm.openfront_invalid_result() >>> 0;
    if (exportedInvalid !== INVALID_RESULT) {
      throw new Error(
        `OpenFront Wasm ABI mismatch: expected invalid sentinel ${INVALID_RESULT}, got ${exportedInvalid}`,
      );
    }
  }

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmModule> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmModule(
      source.instance.exports as OpenFrontWasmExports,
    );
  }

  static async fromBytes(
    bytes: Uint8Array<ArrayBufferLike>,
  ): Promise<OpenFrontWasmModule> {
    const ownedBytes = new Uint8Array(bytes);
    const source = await WebAssembly.instantiate(ownedBytes, {});
    return new OpenFrontWasmModule(
      source.instance.exports as OpenFrontWasmExports,
    );
  }

  createMap(
    width: number,
    height: number,
    terrain: Uint8Array,
  ): OpenFrontRustMap {
    const upload = this.upload(terrain);
    const handle = this.wasm.openfront_map_create(width, height, upload);
    if (handle === 0) this.throwLastError("create map");
    return new OpenFrontRustMap(this, handle);
  }

  destroyMap(handle: number): void {
    if (this.wasm.openfront_map_destroy(handle) === 0) {
      this.throwLastError("destroy map");
    }
  }

  mapWidth(handle: number): number {
    return this.readScalar(
      this.wasm.openfront_map_width(handle),
      "read map width",
    );
  }

  mapHeight(handle: number): number {
    return this.readScalar(
      this.wasm.openfront_map_height(handle),
      "read map height",
    );
  }

  mapTileCount(handle: number): number {
    return this.readScalar(
      this.wasm.openfront_map_tile_count(handle),
      "read tile count",
    );
  }

  mapLandCount(handle: number): number {
    return this.readScalar(
      this.wasm.openfront_map_num_land_tiles(handle),
      "read land count",
    );
  }

  mapFalloutCount(handle: number): number {
    return this.readScalar(
      this.wasm.openfront_map_num_tiles_with_fallout(handle),
      "read fallout count",
    );
  }

  packedTile(handle: number, tile: number): number {
    return this.readScalar(
      this.wasm.openfront_map_packed_tile(handle, tile),
      "read packed tile",
    );
  }

  updateTile(handle: number, tile: number, packed: number): boolean {
    const result = this.wasm.openfront_map_update_tile(handle, tile, packed);
    if ((result >>> 0) === INVALID_RESULT) {
      this.throwLastError("update packed tile");
    }
    return result !== 0;
  }

  setOwnerID(handle: number, tile: number, ownerID: number): void {
    if (this.wasm.openfront_map_set_owner_id(handle, tile, ownerID) === 0) {
      this.throwLastError("set owner ID");
    }
  }

  setFallout(handle: number, tile: number, value: boolean): boolean {
    const result = this.wasm.openfront_map_set_fallout(
      handle,
      tile,
      Number(value),
    );
    if ((result >>> 0) === INVALID_RESULT) {
      this.throwLastError("set fallout");
    }
    return result !== 0;
  }

  setDefenseBonus(handle: number, tile: number, value: boolean): void {
    if (
      this.wasm.openfront_map_set_defense_bonus(
        handle,
        tile,
        Number(value),
      ) === 0
    ) {
      this.throwLastError("set defense bonus");
    }
  }

  neighbors4(handle: number, tile: number): Uint32Array {
    return this.runTileQuery(
      () => this.wasm.openfront_map_neighbors4(handle, tile),
      "query cardinal neighbors",
    );
  }

  neighbors8(handle: number, tile: number): Uint32Array {
    return this.runTileQuery(
      () => this.wasm.openfront_map_neighbors8(handle, tile),
      "query diagonal neighbors",
    );
  }

  connectedOwner(handle: number, start: number): Uint32Array {
    return this.runTileQuery(
      () => this.wasm.openfront_map_connected_owner(handle, start),
      "query connected owner region",
    );
  }

  connectedMask(
    handle: number,
    start: number,
    accepted: Uint8Array,
  ): Uint32Array {
    const upload = this.upload(accepted);
    let result: Uint32Array;
    try {
      result = this.runTileQuery(
        () => this.wasm.openfront_map_connected_mask(handle, start, upload),
        "query masked connected region",
      );
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
    return result;
  }

  ownedDepths(
    handle: number,
    starts: Uint32Array,
    ownerID: number,
    maximumDepth: number,
  ): Uint32Array {
    const upload = this.uploadU32(starts);
    let result: Uint32Array;
    try {
      result = this.runTileQuery(
        () =>
          this.wasm.openfront_map_owned_depths(
            handle,
            upload,
            ownerID,
            maximumDepth,
          ),
        "query owned interior depths",
      );
    } finally {
      this.wasm.openfront_upload_destroy(upload);
    }
    return result;
  }

  largestOwnedDepths(handle: number, maximumDepth: number): Uint32Array {
    return this.runTileQuery(
      () => this.wasm.openfront_map_largest_owned_depths(handle, maximumDepth),
      "query largest owned interior depths",
    );
  }

  airPath(handle: number, from: number, to: number, seed: number): Uint32Array {
    return this.runTileQuery(
      () => this.wasm.openfront_map_air_path(handle, from, to, seed >>> 0),
      "query deterministic air path",
    );
  }

  private uploadU32(values: Uint32Array): number {
    if (HOST_IS_LITTLE_ENDIAN) {
      return this.upload(
        new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
      );
    }

    const bytes = new Uint8Array(values.byteLength);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index++) {
      view.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, values[index]!, true);
    }
    return this.upload(bytes);
  }

  private upload(bytes: Uint8Array): number {
    const handle = this.wasm.openfront_upload_create(bytes.byteLength);
    if (handle === 0) this.throwLastError("allocate upload buffer");

    const pointer = this.wasm.openfront_upload_ptr(handle);
    if (this.wasm.openfront_last_error() !== 0) {
      this.wasm.openfront_upload_destroy(handle);
      this.throwLastError("locate upload buffer");
    }

    new Uint8Array(this.wasm.memory.buffer, pointer, bytes.byteLength).set(bytes);
    return handle;
  }

  private readScalar(value: number, operation: string): number {
    if ((value >>> 0) === INVALID_RESULT) this.throwLastError(operation);
    return value >>> 0;
  }

  private runTileQuery(
    query: () => number,
    operation: string,
  ): Uint32Array {
    if (query() === 0) this.throwLastError(operation);
    const pointer = this.wasm.openfront_result_ptr();
    const length = this.wasm.openfront_result_len();
    return new Uint32Array(
      new Uint32Array(this.wasm.memory.buffer, pointer, length),
    );
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}
