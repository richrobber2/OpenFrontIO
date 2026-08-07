// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Game } from "../../src/core/game/Game";
import { GameMapImpl, type TileRef } from "../../src/core/game/GameMap";
import { PathFinding } from "../../src/core/pathfinding/PathFinder";
import type { PathFinder } from "../../src/core/pathfinding/types";
import {
  disposeRustPathfinding,
  initializeRustPathfindingFromBytes,
  rustPathfindingStats,
} from "../../src/core/rust/RustPathfindingService";

const MINI_WIDTH = 96;
const MINI_HEIGHT = 16;
const MAIN_WIDTH = MINI_WIDTH * 2;
const MAIN_HEIGHT = MINI_HEIGHT * 2;
const WATER = 5;

async function wasmBytes(): Promise<Uint8Array> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return new Uint8Array(await readFile(wasmPath));
}

function makeGame() {
  const miniTerrain = new Uint8Array(MINI_WIDTH * MINI_HEIGHT).fill(WATER);
  const mainTerrain = new Uint8Array(MAIN_WIDTH * MAIN_HEIGHT).fill(WATER);
  const mainMap = new GameMapImpl(MAIN_WIDTH, MAIN_HEIGHT, mainTerrain, 0);
  const miniMap = new GameMapImpl(MINI_WIDTH, MINI_HEIGHT, miniTerrain, 0);

  const row = 8;
  const rawPath = Array.from(
    { length: 80 },
    (_, x) => miniMap.ref(x + 4, row),
  );

  const hpa: PathFinder<TileRef> = {
    findPath: () => rawPath.slice(),
  };
  const graph = {
    nodeCount: 100,
    getComponentId: (_tile: TileRef) => 1,
  };

  const start = mainMap.ref(miniMap.x(rawPath[0]) * 2, row * 2);
  const goal = mainMap.ref(
    miniMap.x(rawPath[rawPath.length - 1]) * 2,
    row * 2,
  );

  const game = {
    map: () => mainMap,
    miniMap: () => miniMap,
    miniWaterHPA: () => hpa,
    miniWaterGraph: () => graph,
    waterGraphVersion: () => 1,
    manhattanDist: (a: TileRef, b: TileRef) => mainMap.manhattanDist(a, b),
    isValidRef: (tile: TileRef) => mainMap.isValidRef(tile),
  } as unknown as Game;

  return { game, start, goal };
}

describe("live Rust water refinement integration", () => {
  it("routes production water endpoint refinement through Rust", async () => {
    const { game, start, goal } = makeGame();
    await initializeRustPathfindingFromBytes(game, await wasmBytes());

    try {
      const result = PathFinding.Water(game).findPath(start, goal);

      expect(result).not.toBeNull();
      expect(result![0]).toBe(start);
      expect(result![result!.length - 1]).toBe(goal);
      expect(rustPathfindingStats(game)).toMatchObject({
        enabled: true,
        waterRefinementQueries: 2,
        failures: 0,
      });
    } finally {
      disposeRustPathfinding(game);
    }
  });

  it("keeps bounded refinement in TypeScript when Rust is unavailable", () => {
    const { game, start, goal } = makeGame();
    const result = PathFinding.Water(game).findPath(start, goal);

    expect(result).not.toBeNull();
    expect(result![0]).toBe(start);
    expect(result![result!.length - 1]).toBe(goal);
    expect(rustPathfindingStats(game)).toMatchObject({
      enabled: false,
      waterRefinementQueries: 0,
    });
  });
});
