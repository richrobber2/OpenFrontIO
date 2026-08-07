// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AStarRail } from "../../src/core/pathfinding/algorithms/AStar.Rail";

const WIDTH = 9;
const HEIGHT = 7;
const LAND = (1 << 7) | 1;
const SHORE_LAND = (1 << 7) | (1 << 6) | 1;
const SHORE_WATER = 1 << 6;

function expectedPath(
  map: GameMapImpl,
  starts: number[],
  goal: number,
): number[] {
  return new AStarRail(map).findPath(starts, goal) ?? [];
}

describe("rail path TypeScript/WebAssembly parity", () => {
  it("matches exact A* routes including multi-start and shoreline costs", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
    const terrain = new Uint8Array(WIDTH * HEIGHT).fill(LAND);

    // Add a short shoreline/water crossing and an open-water section that rail
    // cannot cross. This exercises both water penalty and traversability rules.
    terrain[3 * WIDTH + 3] = SHORE_LAND;
    terrain[3 * WIDTH + 4] = SHORE_WATER;
    terrain[3 * WIDTH + 5] = SHORE_LAND;
    terrain[1 * WIDTH + 4] = 0;
    terrain[2 * WIDTH + 4] = 0;

    const typescriptMap = new GameMapImpl(
      WIDTH,
      HEIGHT,
      terrain.slice(),
      terrain.length,
    );
    const rustMap = module.createMap(WIDTH, HEIGHT, terrain);

    try {
      const cases: Array<{ starts: number[]; goal: number }> = [
        { starts: [0], goal: WIDTH * HEIGHT - 1 },
        { starts: [WIDTH - 1], goal: WIDTH * (HEIGHT - 1) },
        { starts: [3 * WIDTH + 2], goal: 3 * WIDTH + 6 },
        { starts: [0, WIDTH - 1], goal: 6 * WIDTH + 4 },
        { starts: [WIDTH * 6, WIDTH * 6 + 8], goal: 4 },
      ];

      for (const { starts, goal } of cases) {
        expect(Array.from(rustMap.railPath(Uint32Array.from(starts), goal))).toEqual(
          expectedPath(typescriptMap, starts, goal),
        );
      }

      expect(Array.from(rustMap.railPath(new Uint32Array(), 0))).toEqual([]);
      expect(() =>
        rustMap.railPath(Uint32Array.from([0]), WIDTH * HEIGHT),
      ).toThrow(/invalid tile reference/);
    } finally {
      rustMap.dispose();
    }
  });
});
