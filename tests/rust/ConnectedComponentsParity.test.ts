// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  ConnectedComponents,
  LAND_MARKER,
} from "../../src/core/pathfinding/algorithms/ConnectedComponents";

const LAND = (1 << 7) | 1;
const WATER = 5;

async function verify(width: number, height: number, terrain: Uint8Array) {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
  const tsMap = new GameMapImpl(width, height, terrain.slice(), terrain.length);
  const ts = new ConnectedComponents(tsMap);
  ts.initialize();
  const rustMap = module.createMap(width, height, terrain);

  try {
    const packed = rustMap.waterComponents();
    const tileCount = packed[0]!;
    const componentCount = packed[1]!;
    expect(tileCount).toBe(width * height);

    const rustIds = packed.subarray(2, 2 + tileCount);
    const rustSizes = packed.subarray(2 + tileCount);

    let maxTsComponent = 0;
    for (let tile = 0; tile < tileCount; tile++) {
      const expected = ts.getComponentId(tile);
      expect(rustIds[tile], `component id at tile ${tile}`).toBe(expected);
      if (expected !== LAND_MARKER && expected !== 0xffff) {
        maxTsComponent = Math.max(maxTsComponent, expected);
      }
    }

    expect(componentCount).toBe(maxTsComponent);
    expect(rustSizes.length).toBe(componentCount);
    for (let id = 1; id <= componentCount; id++) {
      expect(rustSizes[id - 1], `component size ${id}`).toBe(
        ts.getComponentSize(id),
      );
    }
  } finally {
    rustMap.dispose();
  }
}

describe("water connected-component TypeScript/WebAssembly parity", () => {
  it("matches scan-order labels and component sizes", async () => {
    const width = 9;
    const height = 7;
    const terrain = new Uint8Array(width * height).fill(LAND);
    const waterTiles = [
      0, 1, 9, 18,
      5, 6, 14, 15, 23,
      36, 37, 38, 47,
      53, 62,
    ];
    for (const tile of waterTiles) terrain[tile] = WATER;
    await verify(width, height, terrain);
  });

  it("matches Uint16 promotion after 252 isolated water components", async () => {
    const width = 48;
    const height = 48;
    const terrain = new Uint8Array(width * height).fill(LAND);
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        terrain[y * width + x] = WATER;
      }
    }
    await verify(width, height, terrain);
  });
});
