// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Game } from "../../src/core/game/Game";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AStarWaterHierarchical } from "../../src/core/pathfinding/algorithms/AStar.WaterHierarchical";
import { AbstractGraphBuilder } from "../../src/core/pathfinding/algorithms/AbstractGraph";
import { PathFinding } from "../../src/core/pathfinding/PathFinder";
import {
  disposeRustPathfinding,
  initializeRustPathfindingFromBytes,
  rustPathfindingStats,
} from "../../src/core/rust/RustPathfindingService";

const WATER = 5;
const CLUSTER_SIZE = 32;

function makeGame() {
  const miniWidth = 96;
  const miniHeight = 64;
  const mainWidth = miniWidth * 2;
  const mainHeight = miniHeight * 2;
  const miniTerrain = new Uint8Array(miniWidth * miniHeight).fill(WATER);
  const mainTerrain = new Uint8Array(mainWidth * mainHeight).fill(WATER);
  const miniMap = new GameMapImpl(
    miniWidth,
    miniHeight,
    miniTerrain,
    0,
  );
  const mainMap = new GameMapImpl(
    mainWidth,
    mainHeight,
    mainTerrain,
    0,
  );
  const graph = new AbstractGraphBuilder(miniMap, CLUSTER_SIZE).build();
  const hpa = new AStarWaterHierarchical(miniMap, graph);

  // Production selects HPA only after WaterManager has deemed the graph large
  // enough to justify it. This focused integration test supplies that decision
  // while the HPA fallback itself still uses the real graph above.
  const productionGraph = {
    nodeCount: 100,
    getComponentId: (_tile: number) => 1,
  };

  const game = {
    map: () => mainMap,
    miniMap: () => miniMap,
    miniWaterHPA: () => hpa,
    miniWaterGraph: () => productionGraph,
    waterGraphVersion: () => 0,
    manhattanDist: (a: number, b: number) => mainMap.manhattanDist(a, b),
    isValidRef: (tile: number) => mainMap.isValidRef(tile),
  } as unknown as Game;

  return { game, mainMap };
}

async function wasmBytes(): Promise<Uint8Array> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return new Uint8Array(await readFile(wasmPath));
}

describe("live Rust hierarchical water integration", () => {
  it("routes the production hierarchical-water chain through Rust", async () => {
    const { game, mainMap } = makeGame();
    await initializeRustPathfindingFromBytes(game, await wasmBytes());

    try {
      const start = mainMap.ref(10, 10);
      const goal = mainMap.ref(180, 110);
      const route = PathFinding.Water(game).findPath(start, goal);
      const stats = rustPathfindingStats(game);

      expect(route).not.toBeNull();
      expect(route![0]).toBe(start);
      expect(route![route!.length - 1]).toBe(goal);
      expect(stats.enabled).toBe(true);
      expect(stats.hierarchicalWaterQueries).toBeGreaterThan(0);
      expect(stats.waterQueries).toBe(0);
      expect(stats.failures).toBe(0);
    } finally {
      disposeRustPathfinding(game);
    }
  });

  it("keeps the TypeScript hierarchical fallback without Rust", () => {
    const { game, mainMap } = makeGame();
    const start = mainMap.ref(10, 10);
    const goal = mainMap.ref(180, 110);
    const route = PathFinding.Water(game).findPath(start, goal);

    expect(route).not.toBeNull();
    expect(route![0]).toBe(start);
    expect(route![route!.length - 1]).toBe(goal);
    expect(rustPathfindingStats(game)).toMatchObject({
      enabled: false,
      hierarchicalWaterQueries: 0,
    });
  });
});
