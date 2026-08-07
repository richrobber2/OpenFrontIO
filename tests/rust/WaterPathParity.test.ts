// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AStarWater } from "../../src/core/pathfinding/algorithms/AStar.Water";

const WIDTH = 11;
const HEIGHT = 9;
const LAND = (1 << 7) | 1;

function expectedPath(
  map: GameMapImpl,
  starts: number[],
  goal: number,
): number[] {
  return new AStarWater(map).findPath(starts, goal) ?? [];
}

describe("water path TypeScript/WebAssembly parity", () => {
  it("matches exact A* routes across magnitude penalties and multi-start", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);

    // Mostly water. Magnitude 5 is the preferred band. The barriers and
    // penalty bands force the pathfinder to exercise shore avoidance,
    // deep-water cost, the cross-product tie-breaker, and land-goal handling.
    const terrain = new Uint8Array(WIDTH * HEIGHT).fill(5);
    for (let y = 1; y < HEIGHT - 1; y++) {
      if (y !== HEIGHT - 2) terrain[y * WIDTH + 5] = LAND;
    }
    for (let x = 1; x < WIDTH - 1; x++) {
      terrain[2 * WIDTH + x] = 1; // too close to shore, large penalty
      terrain[6 * WIDTH + x] = 14; // deep water, slight penalty
    }
    terrain[4 * WIDTH + 10] = LAND; // legal destination despite being land

    const typescriptMap = new GameMapImpl(
      WIDTH,
      HEIGHT,
      terrain.slice(),
      terrain.length,
    );
    const rustMap = module.createMap(WIDTH, HEIGHT, terrain);

    try {
      const cases: Array<{ starts: number[]; goal: number }> = [
        { starts: [4 * WIDTH], goal: 4 * WIDTH + 10 },
        { starts: [0], goal: WIDTH * HEIGHT - 1 },
        { starts: [WIDTH - 1], goal: WIDTH * (HEIGHT - 1) },
        { starts: [0, WIDTH * (HEIGHT - 1)], goal: 4 * WIDTH + 9 },
        { starts: [3 * WIDTH + 2, 5 * WIDTH + 2], goal: 4 * WIDTH + 8 },
      ];

      for (const { starts, goal } of cases) {
        expect(
          Array.from(rustMap.waterPath(Uint32Array.from(starts), goal)),
        ).toEqual(expectedPath(typescriptMap, starts, goal));
      }

      expect(Array.from(rustMap.waterPath(new Uint32Array(), 0))).toEqual([]);
      expect(() =>
        rustMap.waterPath(Uint32Array.from([0]), WIDTH * HEIGHT),
      ).toThrow(/invalid tile reference/);
    } finally {
      rustMap.dispose();
    }
  });
});
