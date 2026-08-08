// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("terrain delta WebAssembly ABI", () => {
  it("packs sparse terrain changes into GPU scatter records", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const source = await WebAssembly.instantiate(
      new Uint8Array(await readFile(wasmPath)),
      {},
    );
    const wasm = source.instance.exports as unknown as {
      memory: WebAssembly.Memory;
      openfront_upload_create(length: number): number;
      openfront_upload_destroy(handle: number): number;
      openfront_upload_ptr(handle: number): number;
      openfront_upload_len(handle: number): number;
      openfront_upload_set(handle: number, index: number, value: number): number;
      openfront_graphics_terrain_delta_records(
        upload: number,
        count: number,
        width: number,
        height: number,
        ocean: number,
        sand: number,
        plains: number,
        highland: number,
        mountain: number,
      ): number;
    };

    expect(typeof wasm.openfront_graphics_terrain_delta_records).toBe("function");

    const upload = wasm.openfront_upload_create(8);
    expect(upload).not.toBe(0);
    try {
      // [tileRef=0, terrainByte=0x85] as two little-endian u32 words.
      for (let i = 0; i < 4; i++) {
        expect(wasm.openfront_upload_set(upload, i, 0)).toBe(1);
      }
      expect(wasm.openfront_upload_set(upload, 4, 0x85)).toBe(1);
      for (let i = 5; i < 8; i++) {
        expect(wasm.openfront_upload_set(upload, i, 0)).toBe(1);
      }

      expect(
        wasm.openfront_graphics_terrain_delta_records(
          upload,
          1,
          1,
          1,
          0x4785b5,
          0xcccb9e,
          0xbedc8a,
          0xdccb9e,
          0xe6e6e6,
        ),
      ).toBe(upload);
      expect(wasm.openfront_upload_len(upload)).toBe(12);

      const ptr = wasm.openfront_upload_ptr(upload) >>> 0;
      const words = new Uint32Array(wasm.memory.buffer, ptr, 3);
      expect(Array.from(words)).toEqual([
        0,
        0x85,
        (190 | (210 << 8) | (138 << 16) | (255 << 24)) >>> 0,
      ]);
    } finally {
      wasm.openfront_upload_destroy(upload);
    }
  });
});
