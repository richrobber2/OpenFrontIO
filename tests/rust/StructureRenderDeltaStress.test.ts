import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WASM_PATH = path.join(
  PROJECT_ROOT,
  "resources/wasm/openfront_wasm.wasm",
);

const BUILDING_COUNT = 1_200;
const WORDS_PER_RECORD = 7;
const FLOATS_PER_INSTANCE = 6;
const CITY_KIND = 9;
const BUILDING_KIND_COUNT = 6;

function writeRecord(
  words: Uint32Array,
  record: number,
  id: number,
  kind: number,
  active: boolean,
  tile: number,
  owner: number,
  underConstruction: boolean,
  markedForDeletion: boolean,
): void {
  const off = record * WORDS_PER_RECORD;
  words[off] = id;
  words[off + 1] = kind;
  words[off + 2] = active ? 1 : 0;
  words[off + 3] = tile;
  words[off + 4] = owner;
  words[off + 5] = underConstruction ? 1 : 0;
  words[off + 6] = markedForDeletion ? 1 : 0;
}

describe("Rust incremental structure render table", () => {
  test("seeds 1200 buildings then patches and swap-removes single slots", async () => {
    expect(BUILDING_COUNT).toBeGreaterThanOrEqual(1_000);

    const wasmBytes = fs.readFileSync(WASM_PATH);
    const source = await WebAssembly.instantiate(wasmBytes, {});
    const wasm = source.instance.exports as unknown as OpenFrontWasmExports;

    expect(wasm.openfront_structure_renderer_floats_per_instance()).toBe(
      FLOATS_PER_INSTANCE,
    );

    const renderer = wasm.openfront_structure_renderer_create();
    expect(renderer).not.toBe(0);
    const upload = wasm.openfront_upload_create(
      BUILDING_COUNT * WORDS_PER_RECORD * Uint32Array.BYTES_PER_ELEMENT,
    );
    expect(upload).not.toBe(0);

    const uploadWords = (): Uint32Array => {
      const pointer = wasm.openfront_upload_ptr(upload);
      expect(wasm.openfront_last_error()).toBe(0);
      return new Uint32Array(
        wasm.memory.buffer,
        pointer,
        BUILDING_COUNT * WORDS_PER_RECORD,
      );
    };

    try {
      let words = uploadWords();

      for (let index = 0; index < BUILDING_COUNT; index++) {
        writeRecord(
          words,
          index,
          index + 1,
          CITY_KIND + (index % BUILDING_KIND_COUNT),
          true,
          10_000 + index,
          7,
          false,
          false,
        );
      }

      expect(
        wasm.openfront_structure_renderer_update(
          renderer,
          upload,
          BUILDING_COUNT,
        ),
      ).toBe(1);
      expect(wasm.openfront_structure_renderer_instance_count(renderer)).toBe(
        BUILDING_COUNT,
      );
      expect(wasm.openfront_structure_renderer_dirty_start(renderer) >>> 0).toBe(
        0,
      );
      expect(wasm.openfront_structure_renderer_dirty_len(renderer)).toBe(
        BUILDING_COUNT,
      );
      expect(wasm.openfront_structure_renderer_data_len(renderer)).toBe(
        BUILDING_COUNT * FLOATS_PER_INSTANCE,
      );

      let dataPtr = wasm.openfront_structure_renderer_data_ptr(renderer);
      let packed = new Float32Array(
        wasm.memory.buffer,
        dataPtr,
        BUILDING_COUNT * FLOATS_PER_INSTANCE,
      );
      expect(Array.from(packed.subarray(0, 6))).toEqual([
        10_000,
        0,
        7,
        0,
        0,
        0,
      ]);

      // Rust may grow linear memory while expanding its persistent table.
      // Recreate the upload view before every later write, matching the
      // production wrapper's behavior instead of holding a detached buffer.
      words = uploadWords();
      writeRecord(words, 0, 778, CITY_KIND + 4, true, 88_888, 11, true, true);
      expect(wasm.openfront_structure_renderer_update(renderer, upload, 1)).toBe(
        1,
      );
      expect(wasm.openfront_structure_renderer_dirty_start(renderer) >>> 0).toBe(
        777,
      );
      expect(wasm.openfront_structure_renderer_dirty_len(renderer)).toBe(1);

      dataPtr = wasm.openfront_structure_renderer_data_ptr(renderer);
      packed = new Float32Array(
        wasm.memory.buffer,
        dataPtr,
        BUILDING_COUNT * FLOATS_PER_INSTANCE,
      );
      const updated = 777 * FLOATS_PER_INSTANCE;
      expect(Array.from(packed.subarray(updated, updated + 6))).toEqual([
        88_888,
        0,
        11,
        1,
        4,
        1,
      ]);

      // Removing a middle slot swap-compacts the final record into that slot,
      // so exactly one replacement slot is dirty and instanceCount drops.
      words = uploadWords();
      writeRecord(words, 0, 500, CITY_KIND, false, 0, 0, false, false);
      expect(wasm.openfront_structure_renderer_update(renderer, upload, 1)).toBe(
        1,
      );
      expect(wasm.openfront_structure_renderer_instance_count(renderer)).toBe(
        BUILDING_COUNT - 1,
      );
      expect(wasm.openfront_structure_renderer_dirty_start(renderer) >>> 0).toBe(
        499,
      );
      expect(wasm.openfront_structure_renderer_dirty_len(renderer)).toBe(1);

      dataPtr = wasm.openfront_structure_renderer_data_ptr(renderer);
      packed = new Float32Array(
        wasm.memory.buffer,
        dataPtr,
        (BUILDING_COUNT - 1) * FLOATS_PER_INSTANCE,
      );
      const moved = 499 * FLOATS_PER_INSTANCE;
      expect(packed[moved]).toBe(10_000 + BUILDING_COUNT - 1);
      expect(packed[moved + 4]).toBe((BUILDING_COUNT - 1) % BUILDING_KIND_COUNT);
    } finally {
      expect(wasm.openfront_upload_destroy(upload)).toBe(1);
      expect(wasm.openfront_structure_renderer_destroy(renderer)).toBe(1);
    }
  });
});
