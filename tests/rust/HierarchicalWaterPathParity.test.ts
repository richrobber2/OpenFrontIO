// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AStarWaterHierarchical } from "../../src/core/pathfinding/algorithms/AStar.WaterHierarchical";
import { AbstractGraphBuilder } from "../../src/core/pathfinding/algorithms/AbstractGraph";

const LAND = (1 << 7) | 1;
const WATER = 5;
const CLUSTER_SIZE = 32;

async function wasmBytes(): Promise<Uint8Array> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return new Uint8Array(await readFile(wasmPath));
}

function makeTerrain(width: number, height: number): Uint8Array {
  const terrain = new Uint8Array(width * height).fill(WATER);

  // Two long walls with offset gaps force the route to cross several
  // clusters instead of collapsing into a trivial bounded local search.
  for (let y = 0; y < height; y++) {
    if (y < 47 || y > 51) terrain[y * width + 31] = LAND;
    if (y < 12 || y > 16) terrain[y * width + 63] = LAND;
  }
  return terrain;
}

describe("hierarchical water TypeScript/WebAssembly parity", () => {
  it("matches a multi-cluster single-source route", async () => {
    const width = 96;
    const height = 64;
    const terrain = makeTerrain(width, height);
    const tsMap = new GameMapImpl(width, height, terrain.slice(), terrain.length);
    const graph = new AbstractGraphBuilder(tsMap, CLUSTER_SIZE).build();
    const tsFinder = new AStarWaterHierarchical(tsMap, graph);
    const module = await OpenFrontWasmModule.fromBytes(await wasmBytes());
    const rustMap = module.createMap(width, height, terrain);

    try {
      const start = tsMap.ref(5, 8);
      const goal = tsMap.ref(90, 55);
      const expected = tsFinder.findPath(start, goal);
      const actual = Array.from(
        rustMap.hierarchicalWaterPath(Uint32Array.of(start), goal),
      );
      expect(actual).toEqual(expected);
    } finally {
      rustMap.dispose();
    }
  });

  it("matches multi-source winner selection", async () => {
    const width = 96;
    const height = 64;
    const terrain = makeTerrain(width, height);
    const tsMap = new GameMapImpl(width, height, terrain.slice(), terrain.length);
    const graph = new AbstractGraphBuilder(tsMap, CLUSTER_SIZE).build();
    const tsFinder = new AStarWaterHierarchical(tsMap, graph);
    const module = await OpenFrontWasmModule.fromBytes(await wasmBytes());
    const rustMap = module.createMap(width, height, terrain);

    try {
      const starts = [tsMap.ref(4, 5), tsMap.ref(7, 58), tsMap.ref(40, 50)];
      const goal = tsMap.ref(90, 54);
      const expected = tsFinder.findPath(starts, goal);
      const actual = Array.from(
        rustMap.hierarchicalWaterPath(Uint32Array.from(starts), goal),
      );
      expect(actual).toEqual(expected);
    } finally {
      rustMap.dispose();
    }
  });
});
