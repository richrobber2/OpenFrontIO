// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontRustMap } from "../../src/client/rust/OpenFrontRustMap";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import {
  GameMapImpl,
  type GameMap,
  type TileRef,
} from "../../src/core/game/GameMap";

const WIDTH = 4;
const HEIGHT = 3;
const TILE_COUNT = WIDTH * HEIGHT;
const LAND = 1 << 7;
const SHORELINE = 1 << 6;
const OCEAN = 1 << 5;
const FALLOUT = 1 << 13;
const DEFENSE = 1 << 14;

const TERRAIN = new Uint8Array([
  LAND | 1,
  LAND | SHORELINE | 7,
  OCEAN,
  0,
  LAND | 12,
  LAND | 31,
  LAND | 22,
  OCEAN,
  0,
  LAND | 5,
  LAND | 18,
  LAND | SHORELINE | 28,
]);

const TRAVERSAL_MASK = new Uint8Array([
  1, 1, 0, 0,
  1, 0, 1, 1,
  1, 1, 1, 0,
]);

function pack(state: number, terrain: number): number {
  return (((terrain & 0xff) << 16) | (state & 0xffff)) >>> 0;
}

function packedTile(map: GameMap, tile: TileRef): number {
  return pack(map.tileState(tile), map.terrainByte(tile));
}

function diagonalNeighbors(map: GameMap, tile: TileRef): TileRef[] {
  const result: TileRef[] = [];
  map.forEachNeighborWithDiag(tile, (neighbor) => result.push(neighbor));
  return result;
}

function connectedOwner(map: GameMap, start: TileRef): TileRef[] {
  const owner = map.ownerID(start);
  return Array.from(map.bfs(start, (candidateMap, tile) => {
    return candidateMap.ownerID(tile) === owner;
  }));
}

function connectedMask(
  map: GameMap,
  start: TileRef,
  accepted: Uint8Array,
): TileRef[] {
  return Array.from(map.bfs(start, (_candidateMap, tile) => {
    return accepted[tile] !== 0;
  }));
}

function countLand(terrain: Uint8Array): number {
  let count = 0;
  for (const byte of terrain) {
    if ((byte & LAND) !== 0) count++;
  }
  return count;
}

function assertParity(
  checkpoint: string,
  typescriptMap: GameMapImpl,
  rustMap: OpenFrontRustMap,
): void {
  expect(rustMap.width(), `${checkpoint}: width`).toBe(typescriptMap.width());
  expect(rustMap.height(), `${checkpoint}: height`).toBe(
    typescriptMap.height(),
  );
  expect(rustMap.tileCount(), `${checkpoint}: tile count`).toBe(TILE_COUNT);
  expect(rustMap.numLandTiles(), `${checkpoint}: land count`).toBe(
    typescriptMap.numLandTiles(),
  );
  expect(rustMap.numTilesWithFallout(), `${checkpoint}: fallout count`).toBe(
    typescriptMap.numTilesWithFallout(),
  );

  for (let tile = 0; tile < TILE_COUNT; tile++) {
    expect(rustMap.packedTile(tile), `${checkpoint}: packed tile ${tile}`).toBe(
      packedTile(typescriptMap, tile),
    );

    const cardinalOut = new Array<TileRef>(4);
    const cardinalCount = typescriptMap.neighbors4(tile, cardinalOut);
    expect(
      Array.from(rustMap.neighbors4(tile)),
      `${checkpoint}: cardinal neighbors ${tile}`,
    ).toEqual(cardinalOut.slice(0, cardinalCount));

    expect(
      Array.from(rustMap.neighbors8(tile)),
      `${checkpoint}: diagonal neighbors ${tile}`,
    ).toEqual(diagonalNeighbors(typescriptMap, tile));

    expect(
      Array.from(rustMap.connectedOwner(tile)),
      `${checkpoint}: connected owner ${tile}`,
    ).toEqual(connectedOwner(typescriptMap, tile));

    expect(
      Array.from(rustMap.connectedMask(tile, TRAVERSAL_MASK)),
      `${checkpoint}: connected mask ${tile}`,
    ).toEqual(connectedMask(typescriptMap, tile, TRAVERSAL_MASK));
  }
}

describe("GameMap TypeScript/WebAssembly parity", () => {
  it("matches every checkpoint in a deterministic mutation trace", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
    const typescriptMap = new GameMapImpl(
      WIDTH,
      HEIGHT,
      TERRAIN.slice(),
      countLand(TERRAIN),
    );
    const rustMap = module.createMap(WIDTH, HEIGHT, TERRAIN);

    const apply = (checkpoint: string, mutation: () => void): void => {
      mutation();
      assertParity(checkpoint, typescriptMap, rustMap);
    };

    const setOwner = (tile: TileRef, owner: number): void => {
      typescriptMap.setOwnerID(tile, owner);
      rustMap.setOwnerID(tile, owner);
    };

    const setFallout = (tile: TileRef, value: boolean): void => {
      const changed = typescriptMap.hasFallout(tile) !== value;
      typescriptMap.setFallout(tile, value);
      expect(rustMap.setFallout(tile, value)).toBe(changed);
    };

    const setDefense = (tile: TileRef, value: boolean): void => {
      typescriptMap.setDefenseBonus(tile, value);
      rustMap.setDefenseBonus(tile, value);
    };

    const update = (tile: TileRef, value: number): void => {
      const typescriptChanged = typescriptMap.updateTile(tile, value);
      expect(rustMap.updateTile(tile, value)).toBe(typescriptChanged);
    };

    try {
      assertParity("initial", typescriptMap, rustMap);

      apply("owner 0 becomes 7", () => setOwner(0, 7));
      apply("owner 1 becomes 7", () => setOwner(1, 7));
      apply("owner 4 becomes 7", () => setOwner(4, 7));
      apply("owner 5 becomes 9", () => setOwner(5, 9));
      apply("fallout 1 enabled", () => setFallout(1, true));
      apply("fallout 1 enabled idempotently", () => setFallout(1, true));
      apply("defense 4 enabled", () => setDefense(4, true));
      apply("tile 5 becomes fallout water", () => {
        update(5, pack(7 | FALLOUT | DEFENSE, 0));
      });
      apply("tile 2 becomes owned shoreline land", () => {
        update(2, pack(9, LAND | SHORELINE | 18));
      });
      apply("fallout 5 disabled", () => setFallout(5, false));

      let seed = 0x5eed_c0de;
      const next = (): number => {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        return seed;
      };

      for (let step = 0; step < 64; step++) {
        const tile = next() % TILE_COUNT;
        const operation = next() % 4;
        const checkpoint = `seeded step ${step}, operation ${operation}, tile ${tile}`;

        apply(checkpoint, () => {
          switch (operation) {
            case 0:
              setOwner(tile, next() & 0xfff);
              break;
            case 1:
              setFallout(tile, (next() & 1) !== 0);
              break;
            case 2:
              setDefense(tile, (next() & 1) !== 0);
              break;
            case 3:
              update(tile, pack(next() & 0xffff, next() & 0xff));
              break;
          }
        });
      }
    } finally {
      rustMap.dispose();
    }
  });
});
