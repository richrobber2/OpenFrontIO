import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../src/core/GameRunner";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { RustMapShadow } from "../../src/core/rust/RustMapShadow";
import type { GameConfig, GameStartInfo } from "../../src/core/Schemas";
import { simpleHash } from "../../src/core/Util";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WASM_PATH = path.join(
  PROJECT_ROOT,
  "resources/wasm/openfront_wasm.wasm",
);

interface Options {
  ticks: number;
  bots: number;
  checkpointEvery: number;
  seed: string;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    ticks: 300,
    bots: 32,
    checkpointEvery: 50,
    seed: "rust-shadow-dev",
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = (): string => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`missing value for ${argument}`);
      return value;
    };

    switch (argument) {
      case "--ticks":
        options.ticks = positiveInteger(next(), argument);
        break;
      case "--bots":
        options.bots = positiveInteger(next(), argument);
        break;
      case "--checkpoint-every":
        options.checkpointEvery = positiveInteger(next(), argument);
        break;
      case "--seed":
        options.seed = next();
        break;
      default:
        throw new Error(`unknown argument: ${argument}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.debug = () => {};

  if (!fs.existsSync(WASM_PATH)) {
    throw new Error(
      `missing ${WASM_PATH}; run node scripts/build-rust-wasm.mjs first`,
    );
  }

  const gameConfig: GameConfig = {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: options.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  };
  const gameStart: GameStartInfo = {
    gameID: options.seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };

  console.log(
    `Starting Rust shadow game: map=${gameConfig.gameMap}, ` +
      `bots=${options.bots}, ticks=${options.ticks}, seed=${options.seed}`,
  );

  const config = new Config(gameConfig, null, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    gameConfig.gameMap,
    gameConfig.gameMapSize,
    mapLoader,
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
  const shadow = await RustMapShadow.create(
    game.map(),
    fs.readFileSync(WASM_PATH),
  );

  let fatalError: string | undefined;
  let shadowError: Error | undefined;
  let packedUpdates = 0;
  let ticksWithUpdates = 0;

  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (update) => {
      if ("errMsg" in update) {
        fatalError = `${update.errMsg}\n${update.stack ?? ""}`;
        return;
      }

      try {
        shadow.applyPackedTileUpdates(
          game.map(),
          update.packedTileUpdates,
          `tick ${update.tick}`,
        );
        const updateCount = update.packedTileUpdates.length / 2;
        packedUpdates += updateCount;
        if (updateCount > 0) ticksWithUpdates++;
      } catch (error: unknown) {
        shadowError = error instanceof Error ? error : new Error(String(error));
      }
    },
  );
  runner.init();

  try {
    for (let turnNumber = 0; turnNumber < options.ticks; turnNumber++) {
      runner.addTurn({ turnNumber, intents: [] });
      if (!runner.executeNextTick()) {
        throw new Error(
          `game failed at turn ${turnNumber}: ${fatalError ?? "unknown error"}`,
        );
      }
      if (fatalError !== undefined) throw new Error(fatalError);
      if (shadowError !== undefined) throw shadowError;

      if ((turnNumber + 1) % options.checkpointEvery === 0) {
        shadow.assertFullParity(
          game.map(),
          `full checkpoint ${turnNumber + 1}`,
        );
        console.log(
          `Checkpoint ${turnNumber + 1}/${options.ticks}: ` +
            `${packedUpdates} packed updates verified`,
        );
      }
    }

    shadow.assertFullParity(game.map(), "final headless game state");
    if (packedUpdates === 0) {
      throw new Error(
        "headless game produced no packed tile updates; shadow test was not meaningful",
      );
    }

    console.log(
      `Rust shadow game passed: ${options.ticks} ticks, ` +
        `${packedUpdates} packed updates across ${ticksWithUpdates} ticks.`,
    );
  } finally {
    shadow.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
