// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AStarRail } from "../../src/core/pathfinding/algorithms/AStar.Rail";
import { AStarWater } from "../../src/core/pathfinding/algorithms/AStar.Water";

const ITERATIONS = 250;

function bench(label: string, run: () => void): number {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) run();
  const elapsed = performance.now() - start;
  console.log(
    `${label}: ${elapsed.toFixed(3)}ms total (${(elapsed / ITERATIONS).toFixed(4)}ms/query)`,
  );
  return elapsed;
}

describe("Rust pathfinding benchmark", () => {
  it("compares warm repeated rail and water queries", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);

    const width = 96;
    const height = 64;
    const land = (1 << 7) | 1;
    const shorelineLand = (1 << 7) | (1 << 6) | 1;
    const shorelineWater = 1 << 6;

    const railTerrain = new Uint8Array(width * height).fill(land);
    for (let x = 8; x < width - 8; x += 12) {
      railTerrain[31 * width + x] = shorelineLand;
      railTerrain[31 * width + x + 1] = shorelineWater;
      railTerrain[31 * width + x + 2] = shorelineLand;
    }
    const railMapTs = new GameMapImpl(
      width,
      height,
      railTerrain.slice(),
      railTerrain.length,
    );
    const railMapRust = module.createMap(width, height, railTerrain);
    const railStarts = [0, width - 1, width * (height - 1)];
    const railStartsU32 = Uint32Array.from(railStarts);
    const railGoal = width * height - 1;
    const railTs = new AStarRail(railMapTs);

    const waterTerrain = new Uint8Array(width * height).fill(5);
    for (let y = 4; y < height - 4; y++) {
      if (y % 7 !== 0) {
        waterTerrain[y * width + Math.floor(width / 2)] = land;
      }
    }
    for (let x = 1; x < width - 1; x++) {
      waterTerrain[10 * width + x] = 1;
      waterTerrain[45 * width + x] = 14;
    }
    waterTerrain[(height - 2) * width + (width - 2)] = land;
    const waterMapTs = new GameMapImpl(
      width,
      height,
      waterTerrain.slice(),
      waterTerrain.length,
    );
    const waterMapRust = module.createMap(width, height, waterTerrain);
    const waterStarts = [width, width * (height - 2)];
    const waterStartsU32 = Uint32Array.from(waterStarts);
    const waterGoal = (height - 2) * width + (width - 2);
    const waterTs = new AStarWater(waterMapTs);

    try {
      // Warm both implementations before timing to keep startup/JIT/WASM noise out.
      for (let i = 0; i < 20; i++) {
        railTs.findPath(railStarts, railGoal);
        railMapRust.railPath(railStartsU32, railGoal);
        waterTs.findPath(waterStarts, waterGoal);
        waterMapRust.waterPath(waterStartsU32, waterGoal);
      }

      const expectedRail = railTs.findPath(railStarts, railGoal) ?? [];
      const actualRail = Array.from(
        railMapRust.railPath(railStartsU32, railGoal),
      );
      expect(actualRail).toEqual(expectedRail);

      const expectedWater = waterTs.findPath(waterStarts, waterGoal) ?? [];
      const actualWater = Array.from(
        waterMapRust.waterPath(waterStartsU32, waterGoal),
      );
      expect(actualWater).toEqual(expectedWater);

      const tsRailMs = bench("Pathfinding benchmark rail TS", () => {
        railTs.findPath(railStarts, railGoal);
      });
      const rustRailMs = bench("Pathfinding benchmark rail Rust", () => {
        railMapRust.railPath(railStartsU32, railGoal);
      });
      const tsWaterMs = bench("Pathfinding benchmark water TS", () => {
        waterTs.findPath(waterStarts, waterGoal);
      });
      const rustWaterMs = bench("Pathfinding benchmark water Rust", () => {
        waterMapRust.waterPath(waterStartsU32, waterGoal);
      });

      console.log(
        `Rail Rust/TS speedup: ${(tsRailMs / rustRailMs).toFixed(2)}x`,
      );
      console.log(
        `Water Rust/TS speedup: ${(tsWaterMs / rustWaterMs).toFixed(2)}x`,
      );
    } finally {
      railMapRust.dispose();
      waterMapRust.dispose();
    }
  });
});
