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

const packRgb = (rgb: RustTerrainRgb): number =>
  (((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff)) >>> 0;

/**
 * Small main-thread Wasm facade for renderer-side bulk buffer preparation.
 * It intentionally owns a separate Wasm instance from the simulation worker:
 * browser workers cannot share an ordinary WebAssembly.Memory, and graphics
 * must stay on the thread that owns WebGL.
 */
export class OpenFrontWasmGraphics {
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

  static async load(url = DEFAULT_WASM_URL): Promise<OpenFrontWasmGraphics> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load OpenFront graphics Wasm from ${url}: HTTP ${response.status}`,
      );
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmGraphics(
      source.instance.exports as OpenFrontWasmExports,
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

    const input = this.wasm.openfront_upload_create(terrainBytes.byteLength);
    if (input === 0) this.throwLastError("allocate terrain upload buffer");
    let output = 0;
    try {
      const inputPtr = this.wasm.openfront_upload_ptr(input);
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("locate terrain upload buffer");
      }
      new Uint8Array(
        this.wasm.memory.buffer,
        inputPtr,
        terrainBytes.byteLength,
      ).set(terrainBytes);

      output = this.wasm.openfront_graphics_terrain_rgba(
        input,
        width,
        height,
        packRgb(palette.ocean),
        packRgb(palette.sand),
        packRgb(palette.plains),
        packRgb(palette.highland),
        packRgb(palette.mountain),
      );
      if (output === 0) this.throwLastError("build terrain RGBA texture");

      const outputLen = this.wasm.openfront_upload_len(output) >>> 0;
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("read terrain RGBA length");
      }
      const expectedBytes = expectedPixels * 4;
      if (outputLen !== expectedBytes) {
        throw new Error(
          `Unable to build Rust terrain texture: expected ${expectedBytes} RGBA bytes, got ${outputLen}`,
        );
      }
      const outputPtr = this.wasm.openfront_upload_ptr(output);
      if (this.wasm.openfront_last_error() !== 0) {
        this.throwLastError("locate terrain RGBA buffer");
      }
      return new Uint8Array(
        new Uint8Array(this.wasm.memory.buffer, outputPtr, outputLen),
      );
    } finally {
      if (output !== 0) this.wasm.openfront_upload_destroy(output);
      this.wasm.openfront_upload_destroy(input);
    }
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}
