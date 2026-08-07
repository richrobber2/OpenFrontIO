import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenFrontRustMap } from "../../src/client/rust/OpenFrontRustMap";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";
import type { Game } from "../../src/core/game/Game";
import type { TileRef } from "../../src/core/game/GameMap";
import { AirPathFinder } from "../../src/core/pathfinding/PathFinder.Air";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WASM_PATH = path.join(
  PROJECT_ROOT,
  "resources/wasm/openfront_wasm.wasm",
);
const WIDTH = 37;
const HEIGHT = 23;

function fakeGame(seed: number): Game {
  return {
    ticks: () => seed,
    x: (tile: TileRef) => tile % WIDTH,
    y: (tile: TileRef) => Math.floor(tile / WIDTH),
    ref: (x: number, y: number) => y * WIDTH + x,
  } as unknown as Game;
}

describe("Rust air-path parity", () => {
  let rustMap: OpenFrontRustMap;

  beforeAll(async () => {
    const module = await OpenFrontWasmModule.fromBytes(
      fs.readFileSync(WASM_PATH),
    );
    rustMap = module.createMap(WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT));
  });

  afterAll(() => rustMap.dispose());

  it("matches TypeScript routes across seeds and directions", () => {
    const cases = [
      [0, WIDTH * HEIGHT - 1],
      [WIDTH * HEIGHT - 1, 0],
      [WIDTH + 2, WIDTH * 18 + 31],
      [WIDTH * 20 + 35, WIDTH * 2 + 1],
      [WIDTH * 11 + 18, WIDTH * 11 + 18],
      [WIDTH * 3 + 30, WIDTH * 19 + 5],
    ] as const;
    const seeds = [0, 1, 42, 1337, -1, 0x7fffffff, -2147483648];

    for (const seed of seeds) {
      const game = fakeGame(seed);
      for (const [from, to] of cases) {
        const expected = new AirPathFinder(game).findPath(from, to);
        const actual = rustMap.airPath(from, to, seed);
        expect(Array.from(actual), `seed=${seed} from=${from} to=${to}`).toEqual(
          expected,
        );
      }
    }
  });

  it("rejects invalid endpoints", () => {
    expect(() => rustMap.airPath(WIDTH * HEIGHT, 0, 42)).toThrow();
    expect(() => rustMap.airPath(0, WIDTH * HEIGHT, 42)).toThrow();
  });
});
