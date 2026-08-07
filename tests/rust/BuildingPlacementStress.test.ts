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
const QUERY_ROUNDS = 40;
const DENSE_RADIUS = 30;
const OWNED_RADIUS = 15;

describe("dense structure placement stress", () => {
  test(
    "benchmarks the live build-preview validation path with 1200 nearby buildings",
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
        gameID: "rust-building-placement-stress",
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
        throw new Error("World placement stress game has no nation owner");
      }

      // NationCreation registers nation players before their spawn executions
      // have claimed territory. Pick a safe interior land tile, then explicitly
      // conquer a compact patch so PlayerImpl is alive and build-preview BFS
      // sees the same owned-territory invariant as a live match.
      let targetTile = -1;
      for (let tile = 0; tile < game.width() * game.height(); tile++) {
        if (!game.isLand(tile) || game.isImpassable(tile)) continue;
        const x = game.x(tile);
        const y = game.y(tile);
        const margin = Math.min(
          x,
          y,
          game.width() - 1 - x,
          game.height() - 1 - y,
        );
        if (margin >= DENSE_RADIUS) {
          targetTile = tile;
          break;
        }
      }
      expect(targetTile).toBeGreaterThanOrEqual(0);

      const tx = game.x(targetTile);
      const ty = game.y(targetTile);
      let conquered = 0;
      for (let dy = -OWNED_RADIUS; dy <= OWNED_RADIUS; dy++) {
        for (let dx = -OWNED_RADIUS; dx <= OWNED_RADIUS; dx++) {
          if (dx * dx + dy * dy >= OWNED_RADIUS * OWNED_RADIUS) continue;
          const tile = game.ref(tx + dx, ty + dy);
          if (!game.isLand(tile) || game.isImpassable(tile)) continue;
          owner.conquer(tile);
          conquered++;
        }
      }
      expect(conquered).toBeGreaterThan(0);
      expect(owner.isAlive()).toBe(true);
      expect(game.owner(targetTile)).toBe(owner);

      // Pack actual UnitImpl structures around the cursor. Direct buildUnit is
      // intentional here: the stress population must be much denser than normal
      // placement rules allow so validStructureSpawnTiles hits its worst-case
      // candidate-tile × nearby-building rejection loop.
      const candidates: Array<{ tile: number; distSq: number }> = [];
      for (let dy = -DENSE_RADIUS; dy <= DENSE_RADIUS; dy++) {
        for (let dx = -DENSE_RADIUS; dx <= DENSE_RADIUS; dx++) {
          const distSq = dx * dx + dy * dy;
          if (distSq > DENSE_RADIUS * DENSE_RADIUS) continue;
          candidates.push({ tile: game.ref(tx + dx, ty + dy), distSq });
        }
      }
      candidates.sort((a, b) => a.distSq - b.distSq);
      expect(candidates.length).toBeGreaterThanOrEqual(BUILDING_COUNT);

      for (let i = 0; i < BUILDING_COUNT; i++) {
        owner.buildUnit(UnitType.City, candidates[i]!.tile, {});
      }
      expect(game.unitCount(UnitType.City)).toBe(BUILDING_COUNT);

      // Warm the exact PlayerImpl.buildableUnits path used by
      // BuildPreviewController's 50 ms playerBuildables polling loop.
      const warm = owner.buildableUnits(targetTile, [UnitType.City]);
      expect(warm).toHaveLength(1);

      let observed = 0;
      const start = performance.now();
      for (let round = 0; round < QUERY_ROUNDS; round++) {
        observed += owner.buildableUnits(targetTile, [UnitType.City]).length;
      }
      const elapsed = performance.now() - start;
      expect(observed).toBe(QUERY_ROUNDS);

      console.log(
        `Dense building placement stress: ${BUILDING_COUNT} nearby UnitImpl cities; ` +
          `${QUERY_ROUNDS} buildableUnits() queries in ${elapsed.toFixed(3)}ms ` +
          `(${(elapsed / QUERY_ROUNDS).toFixed(3)}ms/query)`,
      );
    },
    30_000,
  );
});
