import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  UNIT_CLASS_LIGHT,
  UNIT_CLASS_MOBILE,
  UNIT_CLASS_STRUCTURE,
} from "../../src/client/rust/OpenFrontWasmUnits";
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
const BUILDING_KIND_FIRST = 9; // City in the canonical ALL_UNIT_TYPES order.
const BUILDING_KIND_COUNT = 6; // City, Port, Factory, Defense, SAM, Silo.
const WORDS_PER_RECORD = 3;
const BENCHMARK_ROUNDS = 50;

describe("Rust unit classification building stress", () => {
  test("classifies at least 1000 active buildings without leaking into mobile subsets", async () => {
    expect(BUILDING_COUNT).toBeGreaterThanOrEqual(1_000);

    const wasmBytes = fs.readFileSync(WASM_PATH);
    const source = await WebAssembly.instantiate(wasmBytes, {});
    const wasm = source.instance.exports as unknown as OpenFrontWasmExports;

    const upload = wasm.openfront_upload_create(
      BUILDING_COUNT * WORDS_PER_RECORD * Uint32Array.BYTES_PER_ELEMENT,
    );
    expect(upload).not.toBe(0);

    try {
      const pointer = wasm.openfront_upload_ptr(upload);
      expect(wasm.openfront_last_error()).toBe(0);
      const words = new Uint32Array(
        wasm.memory.buffer,
        pointer,
        BUILDING_COUNT * WORDS_PER_RECORD,
      );

      for (let index = 0; index < BUILDING_COUNT; index++) {
        const offset = index * WORDS_PER_RECORD;
        words[offset] = index + 1;
        words[offset + 1] = BUILDING_KIND_FIRST + (index % BUILDING_KIND_COUNT);
        words[offset + 2] = 1;
      }

      let classifyMs = 0;
      for (let round = 0; round < BENCHMARK_ROUNDS; round++) {
        // Rust overwrites the active lane with flags, so restore only that lane.
        for (let index = 0; index < BUILDING_COUNT; index++) {
          words[index * WORDS_PER_RECORD + 2] = 1;
        }
        const start = performance.now();
        expect(wasm.openfront_units_classify(upload, BUILDING_COUNT)).toBe(1);
        classifyMs += performance.now() - start;
      }

      for (let index = 0; index < BUILDING_COUNT; index++) {
        const offset = index * WORDS_PER_RECORD;
        expect(words[offset]).toBe(index + 1);
        expect(words[offset + 1]).toBe(
          BUILDING_KIND_FIRST + (index % BUILDING_KIND_COUNT),
        );
        const flags = words[offset + 2];
        expect(flags & UNIT_CLASS_STRUCTURE).not.toBe(0);
        expect(flags & UNIT_CLASS_MOBILE).toBe(0);
        expect(flags & UNIT_CLASS_LIGHT).not.toBe(0);
      }

      // Also verify mass removal/inactivation in one 1,200-building delta.
      for (let index = 0; index < BUILDING_COUNT; index++) {
        words[index * WORDS_PER_RECORD + 2] = 0;
      }
      expect(wasm.openfront_units_classify(upload, BUILDING_COUNT)).toBe(1);
      for (let index = 0; index < BUILDING_COUNT; index++) {
        expect(words[index * WORDS_PER_RECORD + 2]).toBe(0);
      }

      console.log(
        `Rust building classifier stress: ${BUILDING_COUNT} buildings x ` +
          `${BENCHMARK_ROUNDS} rounds in ${classifyMs.toFixed(3)}ms ` +
          `(${(classifyMs / BENCHMARK_ROUNDS).toFixed(3)}ms/batch)`,
      );
    } finally {
      expect(wasm.openfront_upload_destroy(upload)).toBe(1);
    }
  });
});
