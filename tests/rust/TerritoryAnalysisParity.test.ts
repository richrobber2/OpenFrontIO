// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import {
  GameMapImpl,
  type GameMap,
  type TileRef,
} from "../../src/core/game/GameMap";

const WIDTH = 7;
const HEIGHT = 5;
const LAND = (1 << 7) | 1;

function analyzeTypeScript(
  map: GameMap,
  ownerID: number,
  maximumDepth: number,
): number[] {
  const borders: TileRef[] = [];
  let tileCount = 0;
  const neighbors = new Array<TileRef>(4);

  for (let tile = 0; tile < map.width() * map.height(); tile++) {
    if (map.ownerID(tile) !== ownerID) continue;
    tileCount++;
    const count = map.neighbors4(tile, neighbors);
    for (let index = 0; index < count; index++) {
      if (map.ownerID(neighbors[index]!) !== ownerID) {
        borders.push(tile);
        break;
      }
    }
  }

  const depths = new Map<TileRef, number>();
  const queue: TileRef[] = [];
  for (const border of borders) {
    if (depths.has(border)) continue;
    depths.set(border, 0);
    queue.push(border);
  }

  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index]!;
    const depth = depths.get(tile)!;
    if (depth >= maximumDepth) continue;
    const count = map.neighbors4(tile, neighbors);
    for (let neighborIndex = 0; neighborIndex < count; neighborIndex++) {
      const neighbor = neighbors[neighborIndex]!;
      if (depths.has(neighbor) || map.ownerID(neighbor) !== ownerID) continue;
      depths.set(neighbor, depth + 1);
      queue.push(neighbor);
    }
  }

  const flatDepths = [...depths.entries()].flatMap(([tile, depth]) => [tile, depth]);
  return [
    ownerID,
    tileCount,
    borders.length,
    depths.size,
    ...borders,
    ...flatDepths,
  ];
}

describe("owner territory TypeScript/WebAssembly parity", () => {
  it("matches count, borders, and interior depths for arbitrary owners", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
    const terrain = new Uint8Array(WIDTH * HEIGHT).fill(LAND);
    const typescriptMap = new GameMapImpl(
      WIDTH,
      HEIGHT,
      terrain.slice(),
      terrain.length,
    );
    const rustMap = module.createMap(WIDTH, HEIGHT, terrain);

    try {
      for (let y = 1; y <= 3; y++) {
        for (let x = 1; x <= 5; x++) {
          const tile = y * WIDTH + x;
          typescriptMap.setOwnerID(tile, 7);
          rustMap.setOwnerID(tile, 7);
        }
      }

      for (const [ownerID, depth] of [
        [7, 0],
        [7, 1],
        [7, 4],
        [9, 4],
      ] as const) {
        expect(Array.from(rustMap.ownerTerritoryAnalysis(ownerID, depth))).toEqual(
          analyzeTypeScript(typescriptMap, ownerID, depth),
        );
      }

      const center = 2 * WIDTH + 3;
      typescriptMap.setOwnerID(center, 9);
      rustMap.setOwnerID(center, 9);
      expect(Array.from(rustMap.ownerTerritoryAnalysis(7, 8))).toEqual(
        analyzeTypeScript(typescriptMap, 7, 8),
      );
      expect(Array.from(rustMap.ownerTerritoryAnalysis(9, 8))).toEqual(
        analyzeTypeScript(typescriptMap, 9, 8),
      );

      expect(() => rustMap.ownerTerritoryAnalysis(0x1000, 2)).toThrow(
        /owner ID exceeds/,
      );
    } finally {
      rustMap.dispose();
    }
  });
});
