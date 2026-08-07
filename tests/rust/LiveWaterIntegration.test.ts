// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Game } from "../../src/core/game/Game";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { PathFinding } from "../../src/core/pathfinding/PathFinder";
import {
  disposeRustPathfinding,
  initializeRustPathfindingFromBytes,
  rustPathfindingStats,
} from "../../src/core/rust/RustPathfindingService";

const WATER = 5;

function makeGame() {
  const mainWidth = 12;
  const mainHeight = 8;
  const miniWidth = mainWidth / 2;
  const miniHeight = mainHeight / 2;
  const mainTerrain = new Uint8Array(mainWidth * mainHeight).fill(WATER);
  const miniTerrain = new Uint8Array(miniWidth * miniHeight).fill(WATER);
  const mainMap = new GameMapImpl(
    mainWidth,
    mainHeight,
    mainTerrain,
    0,
  );
  const miniMap = new GameMapImpl(
    miniWidth,
    miniHeight,
    miniTerrain,
    0,
  );

  const game = {
    map: () => mainMap,
    miniMap: () => miniMap,
    miniWaterHPA: () => null,
    miniWaterGraph: () => null,
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

describe("live Rust simple water integration", () => {
  it("routes the production simple-water chain through Rust", async () => {
    const { game, mainMap } = makeGame();
    await initializeRustPathfindingFromBytes(game, await wasmBytes());

    try {
      const water = PathFinding.Water(game);
      const start = mainMap.ref(0, 0);
      const goal = mainMap.ref(10, 6);
      const route = water.findPath(start, goal);

      expect(route).not.toBeNull();
      expect(route![0]).toBe(start);
      expect(route![route!.length - 1]).toBe(goal);
      expect(rustPathfindingStats(game)).toMatchObject({
        enabled: true,
        waterQueries: 1,
        rebuilds: 0,
        failures: 0,
      });
    } finally {
      disposeRustPathfinding(game);
    }
  });

  it("keeps the TypeScript simple-water fallback when Rust was not initialized", () => {
    const { game, mainMap } = makeGame();
    const start = mainMap.ref(0, 0);
    const goal = mainMap.ref(10, 6);
    const route = PathFinding.Water(game).findPath(start, goal);

    expect(route).not.toBeNull();
    expect(route![0]).toBe(start);
    expect(route![route!.length - 1]).toBe(goal);
    expect(rustPathfindingStats(game)).toMatchObject({
      enabled: false,
      waterQueries: 0,
    });
  });
});
