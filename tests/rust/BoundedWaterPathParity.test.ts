// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  AStarWaterBounded,
  type SearchBounds,
} from "../../src/core/pathfinding/algorithms/AStar.WaterBounded";

const WIDTH = 14;
const HEIGHT = 10;
const LAND = (1 << 7) | 1;

function tile(x: number, y: number): number {
  return y * WIDTH + x;
}

describe("bounded water path TypeScript/WebAssembly parity", () => {
  it("matches explicit bounds, multi-start, clamping and persistent scratch", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const module = await OpenFrontWasmModule.fromBytes(
      new Uint8Array(await readFile(wasmPath)),
    );

    const terrain = new Uint8Array(WIDTH * HEIGHT).fill(5);
    for (let y = 1; y < HEIGHT - 1; y++) {
      if (y !== 7) terrain[tile(7, y)] = LAND;
    }
    for (let x = 2; x < WIDTH - 2; x++) {
      terrain[tile(x, 2)] = 1;
      terrain[tile(x, 8)] = 14;
    }
    terrain[tile(11, 6)] = LAND;

    const tsMap = new GameMapImpl(WIDTH, HEIGHT, terrain.slice(), terrain.length);
    const rustMap = module.createMap(WIDTH, HEIGHT, terrain);
    const ts = new AStarWaterBounded(tsMap, WIDTH * HEIGHT);

    const cases: Array<{
      starts: number[];
      goal: number;
      bounds: SearchBounds;
    }> = [
      {
        starts: [tile(2, 4)],
        goal: tile(11, 6),
        bounds: { minX: 1, maxX: 12, minY: 3, maxY: 8 },
      },
      {
        starts: [tile(2, 4), tile(2, 7)],
        goal: tile(11, 7),
        bounds: { minX: 1, maxX: 12, minY: 3, maxY: 8 },
      },
      // TypeScript deliberately clamps starts outside the explicit bounds.
      {
        starts: [tile(0, 0)],
        goal: tile(10, 6),
        bounds: { minX: 2, maxX: 11, minY: 3, maxY: 8 },
      },
      {
        starts: [tile(3, 5)],
        goal: tile(10, 5),
        bounds: { minX: 3, maxX: 10, minY: 4, maxY: 6 },
      },
    ];

    try {
      for (let repeat = 0; repeat < 8; repeat++) {
        for (const { starts, goal, bounds } of cases) {
          const expected = ts.searchBounded(starts, goal, bounds) ?? [];
          const actual = Array.from(
            rustMap.boundedWaterPath(Uint32Array.from(starts), goal, bounds),
          );
          expect(actual).toEqual(expected);
        }
      }

      expect(() =>
        rustMap.boundedWaterPath(
          Uint32Array.from([tile(2, 4)]),
          WIDTH * HEIGHT,
          { minX: 1, maxX: 12, minY: 3, maxY: 8 },
        ),
      ).toThrow(/invalid tile reference/);
    } finally {
      rustMap.dispose();
    }
  });
});
