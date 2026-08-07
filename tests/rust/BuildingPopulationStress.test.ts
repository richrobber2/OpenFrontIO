// @vitest-environment node

import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Config } from "../../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import type { GameConfig, GameStartInfo } from "../../src/core/Schemas";
import { simpleHash } from "../../src/core/Util";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BUILDING_COUNT = 1_200;
const FULL_SCAN_ROUNDS = 100;

describe("real game building population stress", () => {
  test(
    "creates at least 1000 actual buildings in the game unit grid",
    async () => {
      expect(BUILDING_COUNT).toBeGreaterThanOrEqual(1_000);

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        gameMapSize: GameMapSize.Normal,
        gameMode: GameMode.FFA,
        gameType: GameType.Public,
        difficulty: Difficulty.Medium,
        nations: "default",
        donateGold: false,
        donateTroops: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
      };
      const gameStart: GameStartInfo = {
        gameID: "rust-building-population-stress",
        lobbyCreatedAt: 0,
        config: gameConfig,
        players: [],
      };

      const config = new Config(gameConfig, null, false);
      const loader = new NodeGameMapLoader(
        path.join(PROJECT_ROOT, "resources/maps"),
      );
      const terrain = await loadTerrainMap(
        gameConfig.gameMap,
        gameConfig.gameMapSize,
        loader,
        false,
      );
      const random = new PseudoRandom(simpleHash(gameStart.gameID));
      const nations = createNationsForGame(
        gameStart,
        terrain.nations,
        terrain.additionalNations,
        0,
        random,
      );
      const game = createGame(
        [],
        nations,
        terrain.gameMap,
        terrain.miniGameMap,
        config,
        terrain.teamGameSpawnAreas,
      );
      const owner = game.allPlayers()[0];
      if (owner === undefined) {
        throw new Error("World building stress game has no nation owner");
      }

      let built = 0;
      const tileCount = game.width() * game.height();
      for (let tile = 0; tile < tileCount && built < BUILDING_COUNT; tile++) {
        if (!game.isLand(tile) || game.isImpassable(tile)) continue;
        owner.buildUnit(UnitType.City, tile, {});
        built++;
      }
      expect(built).toBe(BUILDING_COUNT);
      expect(game.unitCount(UnitType.City)).toBe(BUILDING_COUNT);

      const warm = game.units();
      expect(warm.length).toBe(BUILDING_COUNT);

      let observedUnits = 0;
      const start = performance.now();
      for (let round = 0; round < FULL_SCAN_ROUNDS; round++) {
        observedUnits += game.units().length;
      }
      const elapsed = performance.now() - start;
      expect(observedUnits).toBe(BUILDING_COUNT * FULL_SCAN_ROUNDS);

      console.log(
        `Real building population stress: ${BUILDING_COUNT} UnitImpl cities; ` +
          `${FULL_SCAN_ROUNDS} full game.units() scans in ${elapsed.toFixed(3)}ms ` +
          `(${(elapsed / FULL_SCAN_ROUNDS).toFixed(3)}ms/scan)`,
      );
    },
    30_000,
  );
});
