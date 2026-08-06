// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { RustMapShadow } from "../../src/core/rust/RustMapShadow";

const LAND = 1 << 7;
const FALLOUT = 1 << 13;

function pack(state: number, terrain: number): number {
  return (((terrain & 0xff) << 16) | (state & 0xffff)) >>> 0;
}

async function createShadow(map: GameMapImpl): Promise<RustMapShadow> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return RustMapShadow.create(
    map,
    new Uint8Array(await readFile(wasmPath)),
  );
}

describe("RustMapShadow", () => {
  it("consumes GameImpl-style tile/value pairs and detects omitted updates", async () => {
    const terrain = new Uint8Array([LAND | 1, LAND | 12, 0, LAND | 7]);
    const map = new GameMapImpl(2, 2, terrain, 3);
    const shadow = await createShadow(map);

    try {
      const first = pack(7 | FALLOUT, LAND | 1);
      const second = pack(9, 0);
      map.updateTile(0, first);
      map.updateTile(1, second);

      shadow.applyPackedTileUpdates(
        map,
        new Uint32Array([0, first, 1, second]),
        "paired updates",
      );
      shadow.assertFullParity(map, "after paired updates");

      map.setOwnerID(3, 11);
      expect(() => shadow.assertFullParity(map, "missing update")).toThrow(
        /tile 3 packed/,
      );
    } finally {
      shadow.dispose();
    }
  });

  it("rejects malformed packed update streams", async () => {
    const terrain = new Uint8Array([LAND | 1]);
    const map = new GameMapImpl(1, 1, terrain, 1);
    const shadow = await createShadow(map);

    try {
      expect(() =>
        shadow.applyPackedTileUpdates(
          map,
          new Uint32Array([0]),
          "malformed stream",
        ),
      ).toThrow(/odd length 1/);
    } finally {
      shadow.dispose();
    }
  });
});
