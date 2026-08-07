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

const LAND = (1 << 7) | 1;

function makeGame() {
  const mainWidth = 12;
  const mainHeight = 8;
  const miniWidth = mainWidth / 2;
  const miniHeight = mainHeight / 2;
  const mainTerrain = new Uint8Array(mainWidth * mainHeight).fill(LAND);
  const miniTerrain = new Uint8Array(miniWidth * miniHeight).fill(LAND);
  const mainMap = new GameMapImpl(
    mainWidth,
    mainHeight,
    mainTerrain,
    mainTerrain.length,
  );
  const miniMap = new GameMapImpl(
    miniWidth,
    miniHeight,
    miniTerrain,
    miniTerrain.length,
  );

  const game = {
    map: () => mainMap,
    miniMap: () => miniMap,
    manhattanDist: (a: number, b: number) => mainMap.manhattanDist(a, b),
    isValidRef: (tile: number) => mainMap.isValidRef(tile),
  } as unknown as Game;

  return { game, mainMap, miniMap };
}

async function wasmBytes(): Promise<Uint8Array> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return new Uint8Array(await readFile(wasmPath));
}

describe("live Rust rail integration", () => {
  it("routes the production PathFinding.Rail factory through Rust and rebuilds after mini-map terrain changes", async () => {
    const { game, mainMap, miniMap } = makeGame();
    await initializeRustPathfindingFromBytes(game, await wasmBytes());

    try {
      const rail = PathFinding.Rail(game);
      const start = mainMap.ref(0, 0);
      const goal = mainMap.ref(10, 6);
      const first = rail.findPath(start, goal);

      expect(first).not.toBeNull();
      expect(first![0]).toBe(start);
      expect(first![first!.length - 1]).toBe(goal);
      expect(rustPathfindingStats(game)).toMatchObject({
        enabled: true,
        railQueries: 1,
        rebuilds: 0,
        failures: 0,
      });

      // Rail's Rust mirror tracks mini-map land count. Water-nuke terrain
      // conversion is land -> water, so this forces the same lazy rebuild used
      // in a live match before the next route query.
      miniMap.setWater(miniMap.ref(3, 2));
      const second = rail.findPath(start, goal);
      expect(second).not.toBeNull();
      expect(rustPathfindingStats(game)).toMatchObject({
        enabled: true,
        railQueries: 2,
        rebuilds: 1,
        failures: 0,
      });
    } finally {
      disposeRustPathfinding(game);
    }
  });

  it("keeps the TypeScript rail fallback when Rust was not initialized", () => {
    const { game, mainMap } = makeGame();
    const start = mainMap.ref(0, 0);
    const goal = mainMap.ref(10, 6);
    const path = PathFinding.Rail(game).findPath(start, goal);

    expect(path).not.toBeNull();
    expect(path![0]).toBe(start);
    expect(path![path!.length - 1]).toBe(goal);
    expect(rustPathfindingStats(game).enabled).toBe(false);
  });
});
