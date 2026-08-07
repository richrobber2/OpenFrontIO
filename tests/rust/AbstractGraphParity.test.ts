// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AbstractGraphBuilder } from "../../src/core/pathfinding/algorithms/AbstractGraph";

const LAND = (1 << 7) | 1;
const WATER = 5;

function floatFromBits(bits: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, bits, true);
  return view.getFloat32(0, true);
}

describe("abstract water graph TypeScript/WebAssembly parity", () => {
  it("matches nodes, components, clusters, and weighted edges", async () => {
    const width = 24;
    const height = 16;
    const clusterSize = 8;
    const terrain = new Uint8Array(width * height).fill(WATER);

    // Split the lower-left water into another component and create multiple
    // gateway spans along cluster boundaries instead of one trivial entrance.
    for (let x = 0; x < 8; x++) terrain[10 * width + x] = LAND;
    for (let y = 0; y < 8; y++) {
      if (y !== 1 && y !== 2 && y !== 5 && y !== 6) {
        terrain[y * width + 7] = LAND;
        terrain[y * width + 8] = LAND;
      }
    }
    for (let x = 8; x < 16; x++) {
      if (x !== 10 && x !== 11 && x !== 14) {
        terrain[7 * width + x] = LAND;
        terrain[8 * width + x] = LAND;
      }
    }

    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const wasmBytes = new Uint8Array(await readFile(wasmPath));
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
    const tsMap = new GameMapImpl(width, height, terrain.slice(), terrain.length);
    const tsGraph = new AbstractGraphBuilder(tsMap, clusterSize).build();
    const rustMap = module.createMap(width, height, terrain);

    try {
      const packed = rustMap.abstractGraphSnapshot(clusterSize);
      let cursor = 0;
      const rustClusterSize = packed[cursor++]!;
      const rustClustersX = packed[cursor++]!;
      const rustClustersY = packed[cursor++]!;
      const nodeCount = packed[cursor++]!;
      const edgeCount = packed[cursor++]!;
      const clusterCount = packed[cursor++]!;

      expect(rustClusterSize).toBe(tsGraph.clusterSize);
      expect(rustClustersX).toBe(tsGraph.clustersX);
      expect(rustClustersY).toBe(tsGraph.clustersY);
      expect(nodeCount).toBe(tsGraph.nodeCount);
      expect(edgeCount).toBe(tsGraph.edgeCount);
      expect(clusterCount).toBe(tsGraph.clustersX * tsGraph.clustersY);

      for (let id = 0; id < nodeCount; id++) {
        const expected = tsGraph.getNode(id)!;
        const actual = {
          id: packed[cursor++]!,
          x: packed[cursor++]!,
          y: packed[cursor++]!,
          tile: packed[cursor++]!,
          componentId: packed[cursor++]!,
        };
        expect(actual, `node ${id}`).toEqual(expected);
      }

      for (let cy = 0; cy < rustClustersY; cy++) {
        for (let cx = 0; cx < rustClustersX; cx++) {
          const x = packed[cursor++]!;
          const y = packed[cursor++]!;
          const count = packed[cursor++]!;
          const nodeIds = Array.from(packed.subarray(cursor, cursor + count));
          cursor += count;
          const expected = tsGraph.getCluster(cx, cy)!;
          expect({ x, y, nodeIds }, `cluster ${cx},${cy}`).toEqual(expected);
        }
      }

      for (let id = 0; id < edgeCount; id++) {
        const expected = tsGraph.getEdge(id)!;
        const actual = {
          id: packed[cursor++]!,
          nodeA: packed[cursor++]!,
          nodeB: packed[cursor++]!,
          cost: floatFromBits(packed[cursor++]!),
          clusterX: packed[cursor++]!,
          clusterY: packed[cursor++]!,
        };
        expect(actual, `edge ${id}`).toEqual({
          ...expected,
          cost: Math.fround(expected.cost),
        });
      }

      expect(cursor).toBe(packed.length);
    } finally {
      rustMap.dispose();
    }
  });
});
