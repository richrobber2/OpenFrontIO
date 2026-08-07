// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapSize, GameMapType } from "../../src/core/game/Game";
import type { GameMap, TileRef } from "../../src/core/game/GameMap";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { AStarRail } from "../../src/core/pathfinding/algorithms/AStar.Rail";
import { AStarWater } from "../../src/core/pathfinding/algorithms/AStar.Water";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const ITERATIONS = 12;
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function bench(label: string, run: () => void): number {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) run();
  const elapsed = performance.now() - start;
  console.log(
    `${label}: ${elapsed.toFixed(3)}ms total (${(elapsed / ITERATIONS).toFixed(3)}ms/query)`,
  );
  return elapsed;
}

function findNearest(
  map: GameMap,
  x: number,
  y: number,
  predicate: (tile: TileRef) => boolean,
): TileRef {
  const width = map.width();
  const height = map.height();
  for (let radius = 0; radius < Math.max(width, height); radius++) {
    const minX = Math.max(0, x - radius);
    const maxX = Math.min(width - 1, x + radius);
    const minY = Math.max(0, y - radius);
    const maxY = Math.min(height - 1, y + radius);
    for (let px = minX; px <= maxX; px++) {
      for (const py of [minY, maxY]) {
        const tile = (py * width + px) as TileRef;
        if (predicate(tile)) return tile;
      }
    }
    for (let py = minY + 1; py < maxY; py++) {
      for (const px of [minX, maxX]) {
        const tile = (py * width + px) as TileRef;
        if (predicate(tile)) return tile;
      }
    }
  }
  throw new Error("unable to find matching tile on World map");
}

function chooseLongRoute(
  map: GameMap,
  pathfinder: { findPath(start: number | number[], goal: number): number[] | null },
  starts: Array<[number, number]>,
  goals: Array<[number, number]>,
  predicate: (tile: TileRef) => boolean,
): { start: TileRef; goal: TileRef; path: number[] } {
  for (const [sx, sy] of starts) {
    const start = findNearest(map, sx, sy, predicate);
    for (const [gx, gy] of goals) {
      const goal = findNearest(map, gx, gy, predicate);
      if (start === goal) continue;
      const path = pathfinder.findPath(start, goal);
      if (path !== null && path.length >= 250) {
        return { start, goal, path };
      }
    }
  }
  throw new Error("unable to find a sufficiently long full-World route");
}

describe("full World Rust pathfinding benchmark", () => {
  it("compares warm rail and water queries on the real 2000x1000 World map", async () => {
    const wasmPath = path.join(PROJECT_ROOT, "resources/wasm/openfront_wasm.wasm");
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);

    const mapLoader = new NodeGameMapLoader(path.join(PROJECT_ROOT, "resources/maps"));
    const terrain = await loadTerrainMap(
      GameMapType.World,
      GameMapSize.Normal,
      mapLoader,
      false,
    );
    const world = terrain.gameMap;
    const rawTerrain = new Uint8Array((world as any).terrain as Uint8Array);

    expect(world.width()).toBe(2000);
    expect(world.height()).toBe(1000);

    const rustMap = module.createMap(world.width(), world.height(), rawTerrain);
    const railTs = new AStarRail(world);
    const waterTs = new AStarWater(world);

    try {
      const rail = chooseLongRoute(
        world,
        railTs,
        [
          [360, 190],
          [470, 285],
          [900, 220],
        ],
        [
          [575, 730],
          [1080, 210],
          [1450, 430],
        ],
        (tile) => world.isLand(tile),
      );

      const water = chooseLongRoute(
        world,
        waterTs,
        [
          [60, 500],
          [780, 500],
          [1500, 500],
        ],
        [
          [720, 500],
          [1450, 500],
          [1920, 500],
        ],
        (tile) => world.isWater(tile),
      );

      const railStart = Uint32Array.of(rail.start);
      const waterStart = Uint32Array.of(water.start);

      expect(Array.from(rustMap.railPath(railStart, rail.goal))).toEqual(rail.path);
      expect(Array.from(rustMap.waterPath(waterStart, water.goal))).toEqual(water.path);

      for (let i = 0; i < 3; i++) {
        railTs.findPath(rail.start, rail.goal);
        rustMap.railPath(railStart, rail.goal);
        waterTs.findPath(water.start, water.goal);
        rustMap.waterPath(waterStart, water.goal);
      }

      console.log(
        `Full World benchmark: ${world.width()}x${world.height()} (${world.width() * world.height()} tiles); rail path ${rail.path.length} tiles; water path ${water.path.length} tiles`,
      );

      const tsRailMs = bench("Full World rail TS", () => {
        railTs.findPath(rail.start, rail.goal);
      });
      const rustRailMs = bench("Full World rail Rust", () => {
        rustMap.railPath(railStart, rail.goal);
      });
      const tsWaterMs = bench("Full World water TS", () => {
        waterTs.findPath(water.start, water.goal);
      });
      const rustWaterMs = bench("Full World water Rust", () => {
        rustMap.waterPath(waterStart, water.goal);
      });

      console.log(`Full World rail Rust/TS speedup: ${(tsRailMs / rustRailMs).toFixed(2)}x`);
      console.log(`Full World water Rust/TS speedup: ${(tsWaterMs / rustWaterMs).toFixed(2)}x`);
    } finally {
      rustMap.dispose();
    }
  });
});
