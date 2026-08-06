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

const WIDTH = 5;
const HEIGHT = 3;
const LAND = (1 << 7) | 1;

function ownedDepthPairs(
  map: GameMap,
  starts: readonly TileRef[],
  ownerID: number,
  maximumDepth: number,
): number[] {
  const depths = new Map<TileRef, number>();
  const queue: TileRef[] = [];
  for (const start of starts) {
    if (depths.has(start)) continue;
    depths.set(start, 0);
    queue.push(start);
  }

  const neighbors = new Array<TileRef>(4);
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

  return [...depths.entries()].flatMap(([tile, depth]) => [tile, depth]);
}

describe("owned-depth TypeScript/WebAssembly parity", () => {
  it("matches the AI interior flood fill for multiple border sources", async () => {
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
      for (let tile = 0; tile < terrain.length; tile++) {
        typescriptMap.setOwnerID(tile, 7);
        rustMap.setOwnerID(tile, 7);
      }

      const starts = [5, 9, 5] as TileRef[];
      expect(
        Array.from(rustMap.ownedDepths(Uint32Array.from(starts), 7, 2)),
      ).toEqual(ownedDepthPairs(typescriptMap, starts, 7, 2));
      expect(
        Array.from(rustMap.ownedDepths(Uint32Array.from(starts), 7, 0)),
      ).toEqual(ownedDepthPairs(typescriptMap, starts, 7, 0));

      typescriptMap.setOwnerID(7, 9);
      rustMap.setOwnerID(7, 9);
      expect(
        Array.from(rustMap.ownedDepths(Uint32Array.from([5]), 7, 8)),
      ).toEqual(ownedDepthPairs(typescriptMap, [5], 7, 8));

      expect(() =>
        rustMap.ownedDepths(Uint32Array.from([5]), 0x1000, 2),
      ).toThrow(/owner ID exceeds/);
    } finally {
      rustMap.dispose();
    }
  });
});
