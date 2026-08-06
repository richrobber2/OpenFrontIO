/**
 * Full-game performance harness for src/core.
 *
 * Runs the real simulation pipeline (GameRunner + Executor + real Config,
 * nations from the map manifest, bots) headlessly on a production map for a
 * configurable number of ticks, then reports:
 *
 *   1. Per-tick wall-time stats (mean/p50/p95/p99/max, ticks over budget)
 *   2. Time per Execution class (AttackExecution, NationExecution, ...)
 *   3. Top functions by self time from the V8 sampling profiler, plus a
 *      .cpuprofile loadable in Chrome DevTools (Performance tab) as a
 *      flame graph.
 *   4. GC churn: GC pause counts/time by kind, allocation rate per
 *      time window across the game, and top allocating functions from the
 *      V8 sampling heap profiler (plus a .heapprofile loadable in Chrome
 *      DevTools > Memory > Allocation sampling).
 *
 * The run is deterministic for a given --seed/--map/--bots, and the final
 * game-state hash is printed so optimizations can be verified to not change
 * simulation behavior.
 *
 * Usage:
 *   npm run perf:game -- [--map world] [--ticks 1800] [--bots 400]
 *                        [--difficulty impossible] [--seed perf-default]
 *                        [--interactive] [--checkpoint-every 1000]
 *                        [--max-minutes 6] [--human-player]
 *                        [--top 30] [--window 1000]
 *                        [--no-cpu-profile] [--no-exec-profile]
 *                        [--no-gc-profile] [--no-alloc-profile]
 *                        [--footprint] [--snapshot-at 0,2000,12000]
 *
 * --footprint records the live heap (used heap after a forced full GC) at
 * every --window boundary; it requires NODE_OPTIONS=--expose-gc.
 * --snapshot-at writes .heapsnapshot files at the given game-phase ticks
 * (0 = right after the spawn phase) for offline attribution; summarize them
 * with tests/perf/fullgame/HeapSnapshotSummary.ts.
 */
import fs from "fs";
import { createInterface } from "node:readline/promises";
import v8 from "node:v8";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../../src/core/configuration/Config";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import { closestTwoTiles } from "../../../src/core/execution/Util";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { GameUpdateType, HashUpdate } from "../../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { canBuildTransportShip } from "../../../src/core/game/TransportShipUtils";
import { GameRunner } from "../../../src/core/GameRunner";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import {
  GameConfig,
  GameStartInfo,
  StampedIntent,
} from "../../../src/core/Schemas";
import { simpleHash } from "../../../src/core/Util";
import {
  AllocationSampler,
  FootprintCheckpoint,
  GcTracker,
  HeapSampler,
  HeapWindow,
  summarizeAllocationProfile,
  summarizeGcEvents,
  takeFootprintCheckpoint,
} from "./GcProfiler";
import { NodeGameMapLoader } from "./NodeGameMapLoader";
import {
  CpuProfiler,
  ExecutionProfiler,
  summarizeCpuProfile,
  TickStats,
} from "./Profiler";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MAX_SPAWN_TURNS = 1000;

// ── CLI ──

interface Options {
  map: GameMapType;
  ticks: number;
  bots: number;
  nations: "default" | "disabled" | number;
  seed: string;
  top: number;
  window: number;
  cpuProfile: boolean;
  execProfile: boolean;
  gcProfile: boolean;
  allocProfile: boolean;
  footprint: boolean;
  snapshotAt: number[];
  waterNukes: boolean;
  difficulty: Difficulty;
  interactive: boolean;
  checkpointEvery: number;
  maxMinutes?: number;
  humanPlayer: boolean;
}

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) {
    const available = Object.keys(GameMapType)
      .map((k) => k.toLowerCase())
      .join(", ");
    throw new Error(`unknown map "${name}". Available: ${available}`);
  }
  return GameMapType[key as keyof typeof GameMapType];
}

function resolveDifficulty(name: string): Difficulty {
  const difficulty = Object.values(Difficulty).find(
    (value) => value.toLowerCase() === name.toLowerCase(),
  );
  if (difficulty === undefined) {
    throw new Error(
      `unknown difficulty "${name}". Available: ${Object.values(Difficulty).join(", ")}`,
    );
  }
  return difficulty;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    map: GameMapType.World,
    ticks: 1800,
    bots: 400,
    nations: "default",
    seed: "perf-default",
    top: 30,
    window: 1000,
    cpuProfile: true,
    execProfile: true,
    gcProfile: true,
    allocProfile: true,
    footprint: false,
    snapshotAt: [],
    waterNukes: false,
    difficulty: Difficulty.Medium,
    interactive: false,
    checkpointEvery: 0,
    humanPlayer: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--map":
        opts.map = resolveMap(next());
        break;
      case "--ticks":
        opts.ticks = parseInt(next(), 10);
        break;
      case "--bots":
        opts.bots = parseInt(next(), 10);
        break;
      case "--difficulty":
        opts.difficulty = resolveDifficulty(next());
        break;
      case "--interactive":
        opts.interactive = true;
        break;
      case "--checkpoint-every":
        opts.checkpointEvery = parseInt(next(), 10);
        break;
      case "--max-minutes":
        opts.maxMinutes = parseInt(next(), 10);
        break;
      case "--human-player":
        opts.humanPlayer = true;
        opts.interactive = true;
        break;
      case "--nations": {
        const v = next();
        opts.nations =
          v === "default" || v === "disabled" ? v : parseInt(v, 10);
        break;
      }
      case "--seed":
        opts.seed = next();
        break;
      case "--top":
        opts.top = parseInt(next(), 10);
        break;
      case "--window":
        opts.window = parseInt(next(), 10);
        break;
      case "--no-cpu-profile":
        opts.cpuProfile = false;
        break;
      case "--no-exec-profile":
        opts.execProfile = false;
        break;
      case "--no-gc-profile":
        opts.gcProfile = false;
        break;
      case "--no-alloc-profile":
        opts.allocProfile = false;
        break;
      case "--footprint":
        opts.footprint = true;
        break;
      case "--snapshot-at":
        opts.snapshotAt = next()
          .split(",")
          .map((v) => parseInt(v, 10));
        break;
      case "--water-nukes":
        opts.waterNukes = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ── Report formatting ──

function fmtMs(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2);
}

function fmtMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? mb.toFixed(0) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, c) => cell.padEnd(widths[c])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w)))]
    .concat(rows.map(line))
    .join("\n");
}

// ── Main ──

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {}; // silence per-tick debug logging

  const gameConfig: GameConfig = {
    gameMap: opts.map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: opts.difficulty,
    nations: opts.nations,
    donateGold: false,
    donateTroops: false,
    bots: opts.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: opts.humanPlayer,
    waterNukes: opts.waterNukes ? true : undefined,
    maxTimerValue: opts.maxMinutes,
  };
  const gameStart: GameStartInfo = {
    gameID: opts.seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: opts.humanPlayer
      ? [{ clientID: "codex_client", username: "Codex", clanTag: null }]
      : [],
  };

  console.log(
    `Loading map "${opts.map}" (bots=${opts.bots}, nations=${opts.nations}, ` +
      `seed=${opts.seed}, ticks=${opts.ticks})...`,
  );

  // Mirrors createGameRunner(), but assembled by hand so the execution
  // profiler can be attached before GameRunner.init() adds the initial
  // executions (nations, bots, spawn timer, win check).
  const config = new Config(gameConfig, null, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    gameConfig.gameMap,
    gameConfig.gameMapSize,
    mapLoader,
  );
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const humans = opts.humanPlayer
    ? [
        new PlayerInfo(
          "Codex",
          PlayerType.Human,
          "codex_client",
          "codex_player",
          true,
        ),
      ]
    : [];
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    humans.length,
    random,
  );
  const game = createGame(
    humans,
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  const execProfiler = new ExecutionProfiler();
  if (opts.execProfile) {
    execProfiler.attach(game);
  }

  let lastHash: HashUpdate | undefined;
  let fatalError: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (gu) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) {
        lastHash = hashes[hashes.length - 1];
      }
    },
  );
  runner.init();

  const gcTracker = opts.gcProfile ? new GcTracker() : null;
  gcTracker?.start();
  const heapSampler = opts.gcProfile ? new HeapSampler() : null;

  const footprints: FootprintCheckpoint[] = [];
  const recordFootprint = (label: string): void => {
    if (!opts.footprint) return;
    const cp = takeFootprintCheckpoint(label);
    if (cp === null) {
      throw new Error(
        "--footprint requires the gc() global; run with NODE_OPTIONS=--expose-gc",
      );
    }
    footprints.push(cp);
  };
  const snapshotDir = path.join(PROJECT_ROOT, "tests/perf/output");
  const writeSnapshot = (label: string): void => {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const file = path.join(
      snapshotDir,
      `fullgame-${opts.map.replace(/\W+/g, "_")}-${opts.seed}-${label}.heapsnapshot`,
    );
    console.log(`Writing heap snapshot ${path.relative(PROJECT_ROOT, file)}…`);
    v8.writeHeapSnapshot(file);
  };

  let turnNumber = 0;
  let pendingIntents: StampedIntent[] = [];
  const runTick = (stats: TickStats): boolean => {
    runner.addTurn({ turnNumber: turnNumber++, intents: pendingIntents });
    pendingIntents = [];
    const tick = game.ticks();
    const start = performance.now();
    const ok = runner.executeNextTick();
    stats.record(tick, performance.now() - start);
    heapSampler?.tick();
    return ok && fatalError === undefined;
  };

  // Spawn phase (SpawnTimerExecution ends it after config.numSpawnPhaseTurns).
  const spawnStats = new TickStats();
  const spawnStart = performance.now();
  while (game.inSpawnPhase()) {
    if (turnNumber >= MAX_SPAWN_TURNS) {
      throw new Error(`spawn phase did not end after ${MAX_SPAWN_TURNS} turns`);
    }
    if (!runTick(spawnStats)) {
      throw new Error(`game errored during spawn phase:\n${fatalError}`);
    }
  }
  const spawnTurns = turnNumber;
  console.log(
    `Spawn phase done: ${spawnTurns} turns in ` +
      `${fmtMs(performance.now() - spawnStart)}ms, ` +
      `${game.players().filter((p) => p.isAlive()).length} players spawned.`,
  );

  let humanPolicy: "bank" | "expand" | "balanced" | "aggressive" = "bank";
  let humanAttackFraction = 0.5;
  let fortifyTargetName: string | null = null;
  let attackTargetName: string | null = null;
  const humanPlayer = (): Player | undefined =>
    game.allPlayers().find((player) => player.clientID() === "codex_client");

  const printAiOutcome = (heading: string): void => {
    const ranked = game
      .players()
      .filter((player) => player.hasSpawned())
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const aiNations = ranked.filter(
      (player) => player.type() === PlayerType.Nation,
    );
    const nationTiles = aiNations.reduce(
      (total, player) => total + player.numTilesOwned(),
      0,
    );
    const totalPlayerTiles = ranked.reduce(
      (total, player) => total + player.numTilesOwned(),
      0,
    );
    console.log(`\n--- ${heading} ---`);
    console.log(`Nations alive:    ${aiNations.length} / ${nations.length}`);
    console.log(
      `Nation territory: ${nationTiles} / ${totalPlayerTiles} player-owned tiles ` +
        `(${totalPlayerTiles === 0 ? "0.0" : ((nationTiles * 100) / totalPlayerTiles).toFixed(1)}%)`,
    );
    const human = humanPlayer();
    if (human !== undefined) {
      const humanRank = ranked.findIndex((player) => player === human) + 1;
      console.log(
        `Human: ${
          human.isAlive()
            ? `rank ${humanRank}, ${human.numTilesOwned()} tiles, ` +
              `${Math.floor(human.troops())}/${Math.floor(config.maxTroops(human))} troops, ` +
              `${human.gold()} gold`
            : "eliminated"
        }`,
      );
      console.log(
        `Policy: ${humanPolicy} at ${(humanAttackFraction * 100).toFixed(0)}%; ` +
          `${human.outgoingAttacks().length} outgoing / ${human.incomingAttacks().length} incoming attacks`,
      );
      console.log(
        `Structures: ${human.unitCount(UnitType.City)} cities, ` +
          `${human.unitCount(UnitType.DefensePost)} defense posts; ` +
          `alliances: ${
            human
              .alliances()
              .map(
                (alliance) =>
                  `${alliance.other(human).name()} (expires ${alliance.expiresAt()})`,
              )
              .join(", ") || "none"
          }`,
      );
      const nearby = human
        .nearby()
        .filter((player): player is Player => player.isPlayer())
        .sort((a, b) => a.troops() - b.troops())
        .slice(0, 6);
      if (nearby.length > 0) {
        console.log(
          `Nearby: ${nearby
            .map(
              (player) =>
                `${player.name()} ${player.numTilesOwned()}t/${Math.floor(player.troops())} troops`,
            )
            .join("; ")}`,
        );
      }
    }
    console.log(
      table(
        ["rank", "AI", "alive", "tiles", "troops"],
        ranked
          .slice(0, 10)
          .map((player, index) => [
            String(index + 1),
            `${player.name()} (${player.type()})`,
            player.isAlive() ? "yes" : "no",
            String(player.numTilesOwned()),
            String(Math.floor(player.troops())),
          ]),
      ),
    );
  };

  const reviewer = opts.interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  let reviewPauseMs = 0;
  const pauseForReview = async (trigger: string): Promise<void> => {
    printAiOutcome(`trigger: ${trigger} (tick ${game.ticks()})`);
    const pauseStarted = performance.now();
    const command = await reviewer?.question(
      opts.humanPlayer
        ? "Command: strategy [10-90%], attack|ally|break|extend|fortify <player>, or Enter: "
        : "Paused for review — press Enter to resume: ",
    );
    if (opts.humanPlayer && command?.trim()) {
      const tokens = command.trim().split(/\s+/);
      const policy = tokens[0].toLowerCase();
      const percent = tokens[1];
      const commandWords = new Set([
        "attack",
        "ally",
        "break",
        "extend",
        "fortify",
        "bank",
        "expand",
        "balanced",
        "aggressive",
      ]);
      const commandTarget = (index: number): string => {
        const end = tokens.findIndex(
          (token, tokenIndex) =>
            tokenIndex > index && commandWords.has(token.toLowerCase()),
        );
        return tokens.slice(index + 1, end === -1 ? undefined : end).join(" ");
      };
      if (
        policy === "bank" ||
        policy === "expand" ||
        policy === "balanced" ||
        policy === "aggressive"
      ) {
        humanPolicy = policy;
      }
      const parsedPercent = Number.parseFloat(percent?.replace("%", ""));
      if (Number.isFinite(parsedPercent)) {
        humanAttackFraction = Math.min(0.9, Math.max(0.1, parsedPercent / 100));
      }
      const allyIndex = tokens.findIndex(
        (token) => token.toLowerCase() === "ally",
      );
      if (allyIndex >= 0 && allyIndex + 1 < tokens.length) {
        const requestedName = commandTarget(allyIndex);
        const recipient = game
          .players()
          .filter((player) => player.type() === PlayerType.Nation)
          .find((player) =>
            player.name().toLowerCase().includes(requestedName.toLowerCase()),
          );
        if (recipient !== undefined) {
          pendingIntents.push({
            type: "allianceRequest",
            recipient: recipient.id(),
            clientID: "codex_client",
          });
          console.log(`Queued alliance request to ${recipient.name()}.`);
        }
      }
      const breakIndex = tokens.findIndex(
        (token) => token.toLowerCase() === "break",
      );
      if (breakIndex >= 0 && breakIndex + 1 < tokens.length) {
        const requestedName = commandTarget(breakIndex);
        const human = humanPlayer();
        const alliance = human
          ?.alliances()
          .find((candidate) =>
            candidate
              .other(human)
              .name()
              .toLowerCase()
              .includes(requestedName.toLowerCase()),
          );
        if (human !== undefined && alliance !== undefined) {
          const recipient = alliance.other(human);
          pendingIntents.push({
            type: "breakAlliance",
            recipient: recipient.id(),
            clientID: "codex_client",
          });
          console.log(`Queued alliance break with ${recipient.name()}.`);
        }
      }
      const extendIndex = tokens.findIndex(
        (token) => token.toLowerCase() === "extend",
      );
      if (extendIndex >= 0 && extendIndex + 1 < tokens.length) {
        const requestedName = commandTarget(extendIndex);
        const human = humanPlayer();
        const alliance = human
          ?.alliances()
          .find((candidate) =>
            candidate
              .other(human)
              .name()
              .toLowerCase()
              .includes(requestedName.toLowerCase()),
          );
        if (human !== undefined && alliance !== undefined) {
          const recipient = alliance.other(human);
          pendingIntents.push({
            type: "allianceExtension",
            recipient: recipient.id(),
            clientID: "codex_client",
          });
          console.log(`Queued alliance extension with ${recipient.name()}.`);
        }
      }
      const fortifyIndex = tokens.findIndex(
        (token) => token.toLowerCase() === "fortify",
      );
      if (fortifyIndex >= 0 && fortifyIndex + 1 < tokens.length) {
        fortifyTargetName = commandTarget(fortifyIndex);
        console.log(`Fortification target set to ${fortifyTargetName}.`);
      }
      const attackIndex = tokens.findIndex(
        (token) => token.toLowerCase() === "attack",
      );
      if (attackIndex >= 0 && attackIndex + 1 < tokens.length) {
        attackTargetName = commandTarget(attackIndex);
        console.log(`Attack target set to ${attackTargetName}.`);
      }
      console.log(
        `Selected ${humanPolicy} at ${(humanAttackFraction * 100).toFixed(0)}%.`,
      );
    }
    reviewPauseMs += performance.now() - pauseStarted;
  };
  if (reviewer !== null) await pauseForReview("spawn complete");
  // The measured game phase begins below, after the spawn checkpoint.
  reviewPauseMs = 0;

  heapSampler?.closeWindow("spawn");
  recordFootprint(`spawn (tick ${game.ticks() - 1})`);
  if (opts.snapshotAt.includes(0)) {
    writeSnapshot("tick0");
  }

  // Main game phase, under the CPU profiler and allocation sampler.
  const cpuProfiler = opts.cpuProfile ? new CpuProfiler() : null;
  if (cpuProfiler) {
    await cpuProfiler.start();
  }
  const allocSampler = opts.allocProfile ? new AllocationSampler() : null;
  if (allocSampler) {
    await allocSampler.start();
  }
  const gameStats = new TickStats();
  const gameStart_ = performance.now();
  let heapPeak = 0;
  let windowStartTick = game.ticks();
  const initialBotCount = game
    .players()
    .filter((player) => player.type() === PlayerType.Bot).length;
  const botMilestones = [0.5, 0.1, 0];
  let nextBotMilestone = 0;
  const leaderMilestones = [0.25, 0.5, 0.75];
  let nextLeaderMilestone = 0;
  let humanEliminationReported = false;

  const queueHumanAction = (): void => {
    const human = humanPlayer();
    if (human === undefined || !human.isAlive()) return;

    const incomingAttackers = new Set(
      human
        .incomingAttacks()
        .filter((attack) => !attack.retreating())
        .map((attack) => attack.attacker()),
    );
    const namedFortifyTarget = fortifyTargetName
      ? game
          .players()
          .find((player) =>
            player
              .name()
              .toLowerCase()
              .includes(fortifyTargetName!.toLowerCase()),
          )
      : undefined;
    if (namedFortifyTarget !== undefined) {
      incomingAttackers.add(namedFortifyTarget);
    }

    // Build defense posts on a selected or active land front before spending
    // the rest of the economy on cities.
    let queuedDefense = false;
    if (
      incomingAttackers.size > 0 &&
      human.unitCount(UnitType.DefensePost) < 4
    ) {
      for (const border of human.borderTiles()) {
        const bordersThreat = game
          .neighbors(border)
          .some(
            (neighbor) =>
              game.hasOwner(neighbor) &&
              incomingAttackers.has(game.owner(neighbor) as Player),
          );
        if (!bordersThreat) continue;
        const candidates = new Set<number>([border]);
        for (const neighbor of game.neighbors(border)) {
          candidates.add(neighbor);
          for (const inner of game.neighbors(neighbor)) candidates.add(inner);
        }
        for (const tile of candidates) {
          if (
            game.owner(tile) !== human ||
            human.canBuild(UnitType.DefensePost, tile) === false
          ) {
            continue;
          }
          pendingIntents.push({
            type: "build_unit",
            unit: UnitType.DefensePost,
            tile,
            clientID: "codex_client",
          });
          queuedDefense = true;
          break;
        }
        if (queuedDefense) break;
      }
    }

    // Spend the human economy through the same construction intent as the UI.
    // Cities raise the troop cap and prevent a large gold balance from sitting
    // idle while Impossible nations compound their structure advantage.
    if (!queuedDefense && human.unitCount(UnitType.City) < 8) {
      for (const tile of human.tiles()) {
        if (human.canBuild(UnitType.City, tile) === false) continue;
        pendingIntents.push({
          type: "build_unit",
          unit: UnitType.City,
          tile,
          clientID: "codex_client",
        });
        break;
      }
    }

    if (human.outgoingAttacks().length >= 2) return;

    let hasLandToExpand = false;
    for (const border of human.borderTiles()) {
      for (const neighbor of game.neighbors(border)) {
        if (
          game.isLand(neighbor) &&
          !game.isImpassable(neighbor) &&
          !game.hasOwner(neighbor)
        ) {
          hasLandToExpand = true;
          break;
        }
      }
      if (hasLandToExpand) break;
    }

    let target: Player | null = null;
    let targetTerraNullius = false;
    const retaliation = human
      .incomingAttacks()
      .filter((attack) => !attack.retreating())
      .sort((a, b) => b.troops() - a.troops())[0];
    if (retaliation !== undefined) {
      target = retaliation.attacker();
    } else if (humanPolicy === "bank") {
      return;
    } else if (
      hasLandToExpand &&
      (humanPolicy === "expand" || humanPolicy === "balanced")
    ) {
      targetTerraNullius = true;
    } else if (humanPolicy !== "expand") {
      const namedAttackTarget = attackTargetName
        ? game
            .players()
            .find((player) =>
              player
                .name()
                .toLowerCase()
                .includes(attackTargetName!.toLowerCase()),
            )
        : undefined;
      if (attackTargetName !== null && namedAttackTarget === undefined) return;
      if (namedAttackTarget !== undefined) {
        if (
          namedAttackTarget === human ||
          human.isFriendly(namedAttackTarget) ||
          !namedAttackTarget.isAlive()
        ) {
          return;
        }
        target = namedAttackTarget;
      }
      const nearby = human
        .nearby()
        .filter(
          (target): target is Player =>
            target.isPlayer() &&
            !human.isFriendly(target) &&
            human.canAttackPlayer(target),
        );
      const candidates = (nearby.length > 0 ? nearby : game.players())
        .filter(
          (candidate) =>
            candidate !== human &&
            !human.isFriendly(candidate) &&
            candidate.isAlive(),
        )
        .sort((a, b) => {
          const aDensity = a.troops() / Math.max(1, a.numTilesOwned());
          const bDensity = b.troops() / Math.max(1, b.numTilesOwned());
          return aDensity - bDensity;
        });
      for (const candidate of target === null ? candidates : []) {
        if (
          humanPolicy !== "aggressive" &&
          candidate.troops() >= human.troops() * 0.8
        ) {
          continue;
        }
        if (human.sharesBorderWith(candidate)) {
          target = candidate;
          break;
        }
        const sourceShore = Array.from(human.borderTiles()).filter((tile) =>
          game.isShore(tile),
        );
        const targetShore = Array.from(candidate.borderTiles()).filter((tile) =>
          game.isShore(tile),
        );
        const closest = closestTwoTiles(game, sourceShore, targetShore);
        if (closest !== null && canBuildTransportShip(game, human, closest.y)) {
          target = candidate;
          break;
        }
      }
    }
    if (!targetTerraNullius && target === null) return;

    const troops = Math.floor(human.troops() * humanAttackFraction);
    if (target !== null && !human.sharesBorderWith(target)) {
      const sourceShore = Array.from(human.borderTiles()).filter((tile) =>
        game.isShore(tile),
      );
      const targetShore = Array.from(target.borderTiles()).filter((tile) =>
        game.isShore(tile),
      );
      const closest = closestTwoTiles(game, sourceShore, targetShore);
      if (closest !== null && canBuildTransportShip(game, human, closest.y)) {
        pendingIntents.push({
          type: "boat",
          dst: closest.y,
          troops,
          clientID: "codex_client",
        });
      }
      return;
    }

    pendingIntents.push({
      type: "attack",
      targetID: targetTerraNullius ? game.terraNullius().id() : target!.id(),
      troops,
      clientID: "codex_client",
    });
  };
  for (let i = 0; i < opts.ticks; i++) {
    if (opts.humanPlayer && i % 25 === 0) queueHumanAction();
    if (!runTick(gameStats)) {
      console.error(`game errored at tick ${game.ticks()}:\n${fatalError}`);
      process.exitCode = 1;
      break;
    }
    if (i % 50 === 0) {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }
    if ((i + 1) % opts.window === 0 || i === opts.ticks - 1) {
      heapSampler?.closeWindow(`${windowStartTick}-${game.ticks() - 1}`);
      windowStartTick = game.ticks();
      recordFootprint(`tick ${game.ticks() - 1}`);
    }
    if (opts.snapshotAt.includes(i + 1)) {
      writeSnapshot(`tick${i + 1}`);
    }

    if (reviewer !== null) {
      const triggers: string[] = [];
      const activePlayers = game.players();
      const botsAlive = activePlayers.filter(
        (player) => player.type() === PlayerType.Bot,
      ).length;
      if (
        nextBotMilestone < botMilestones.length &&
        botsAlive <= initialBotCount * botMilestones[nextBotMilestone]
      ) {
        triggers.push(`bots at ${botsAlive}/${initialBotCount}`);
        nextBotMilestone++;
      }

      const totalPlayerTiles = activePlayers.reduce(
        (total, player) => total + player.numTilesOwned(),
        0,
      );
      const leaderTiles = activePlayers.reduce(
        (largest, player) => Math.max(largest, player.numTilesOwned()),
        0,
      );
      const leaderShare =
        totalPlayerTiles === 0 ? 0 : leaderTiles / totalPlayerTiles;
      if (
        nextLeaderMilestone < leaderMilestones.length &&
        leaderShare >= leaderMilestones[nextLeaderMilestone]
      ) {
        triggers.push(
          `leader reached ${(leaderMilestones[nextLeaderMilestone] * 100).toFixed(0)}% of player territory`,
        );
        nextLeaderMilestone++;
      }
      if (opts.checkpointEvery > 0 && (i + 1) % opts.checkpointEvery === 0) {
        triggers.push(`${i + 1}-tick checkpoint`);
      }
      if (game.getWinner() !== null) triggers.push("winner declared");
      const human = humanPlayer();
      if (
        !humanEliminationReported &&
        human !== undefined &&
        !human.isAlive()
      ) {
        triggers.push("human eliminated");
        humanEliminationReported = true;
      }
      if (triggers.length > 0) await pauseForReview(triggers.join(", "));
      if (game.getWinner() !== null) break;
    }
  }
  reviewer?.close();
  const gamePhaseMs = performance.now() - gameStart_ - reviewPauseMs;
  const profile = cpuProfiler ? await cpuProfiler.stop() : null;
  const allocProfile = allocSampler ? await allocSampler.stop() : null;
  const gcEvents = gcTracker ? await gcTracker.stop() : null;

  // ── Report ──

  const budgetMs = config.msPerTick();
  const summary = gameStats.summarize(budgetMs);
  const alive = game.players().filter((p) => p.isAlive());

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Full game perf: ${opts.map}, ${summary.count} game ticks`);
  console.log("=".repeat(72));

  console.log(`\n--- Game state at end ---`);
  console.log(`Ticks executed:   ${game.ticks()} (${spawnTurns} spawn)`);
  console.log(`Players alive:    ${alive.length} / ${game.players().length}`);
  console.log(`Units:            ${game.units().length}`);
  console.log(
    `Final hash:       ${lastHash ? `${lastHash.hash} (tick ${lastHash.tick})` : "n/a"}`,
  );
  console.log(`Peak heap:        ${(heapPeak / 1024 / 1024).toFixed(0)} MB`);

  printAiOutcome("AI outcome");

  console.log(`\n--- Per-tick wall time (game phase) ---`);
  console.log(
    `Total: ${fmtMs(summary.totalMs)}ms sim time over ${fmtMs(gamePhaseMs)}ms ` +
      `wall (${(summary.count / (gamePhaseMs / 1000)).toFixed(0)} ticks/sec)`,
  );
  console.log(
    `mean ${fmtMs(summary.meanMs)}ms | p50 ${fmtMs(summary.p50Ms)}ms | ` +
      `p95 ${fmtMs(summary.p95Ms)}ms | p99 ${fmtMs(summary.p99Ms)}ms | ` +
      `max ${fmtMs(summary.maxMs)}ms`,
  );
  console.log(
    `Over ${budgetMs}ms budget: ${summary.overBudget} / ${summary.count} ticks`,
  );
  console.log(
    `Slowest ticks: ` +
      summary.slowest.map((s) => `#${s.tick} (${fmtMs(s.ms)}ms)`).join(", "),
  );

  if (footprints.length > 0) {
    console.log(`\n--- Live-heap footprint (after forced full GC) ---`);
    console.log(
      table(
        ["checkpoint", "live MB", "total MB", "ext MB", "arrbuf MB", "rss MB"],
        footprints.map((cp) => [
          cp.label,
          fmtMB(cp.liveHeapBytes),
          fmtMB(cp.totalHeapBytes),
          fmtMB(cp.externalBytes),
          fmtMB(cp.arrayBuffersBytes),
          fmtMB(cp.rssBytes),
        ]),
      ),
    );
  }

  if (opts.execProfile) {
    console.log(`\n--- Time by Execution class ---`);
    const rows = execProfiler.report();
    const grandTotal = rows.reduce((a, r) => a + r.totalMs, 0);
    console.log(
      table(
        [
          "execution",
          "total ms",
          "%",
          "tick ms",
          "init ms",
          "ticks",
          "instances",
        ],
        rows
          .slice(0, opts.top)
          .map((r) => [
            r.name,
            fmtMs(r.totalMs),
            ((r.totalMs * 100) / grandTotal).toFixed(1),
            fmtMs(r.tickMs),
            fmtMs(r.initMs),
            String(r.tickCalls),
            String(r.instances),
          ]),
      ),
    );
    console.log(
      `(execution total ${fmtMs(grandTotal)}ms, includes spawn phase; ` +
        `remainder of tick time is player updates, hashing, and tile updates)`,
    );
  }

  if (gcEvents && heapSampler) {
    const gamePhaseEvents = gcEvents.filter((e) => e.startTime >= gameStart_);
    const gc = summarizeGcEvents(gamePhaseEvents);

    console.log(`\n--- GC (game phase) ---`);
    console.log(
      table(
        ["kind", "count", "total ms", "avg ms", "max ms"],
        (["minor", "major", "incremental", "weakcb", "all"] as const).map(
          (kind) => [
            kind,
            String(gc[kind].count),
            fmtMs(gc[kind].totalMs),
            fmtMs(gc[kind].count > 0 ? gc[kind].totalMs / gc[kind].count : 0),
            fmtMs(gc[kind].maxMs),
          ],
        ),
      ),
    );
    console.log(
      `GC time: ${fmtMs(gc.all.totalMs)}ms = ` +
        `${((gc.all.totalMs * 100) / gamePhaseMs).toFixed(1)}% of game-phase wall time`,
    );

    console.log(`\n--- Allocation & GC by window ---`);
    const windowRow = (w: HeapWindow): string[] => {
      const wgc = summarizeGcEvents(
        gcTracker!.eventsBetween(w.startTime, w.endTime),
      );
      return [
        w.label,
        fmtMB(w.allocatedBytes),
        w.ticks > 0 ? ((w.allocatedBytes / w.ticks) * 1e-3).toFixed(0) : "0",
        String(wgc.minor.count),
        fmtMs(wgc.minor.totalMs),
        String(wgc.major.count),
        fmtMs(wgc.major.totalMs),
        fmtMs(wgc.incremental.totalMs),
        fmtMB(w.heapUsedEnd),
      ];
    };
    console.log(
      table(
        [
          "ticks",
          "alloc MB",
          "KB/tick",
          "minor#",
          "minor ms",
          "major#",
          "major ms",
          "incr ms",
          "heap MB",
        ],
        heapSampler.all().map(windowRow),
      ),
    );
    console.log(
      `(alloc = sum of positive used-heap deltas between ticks; a lower bound on churn)`,
    );
  }

  if (allocProfile) {
    const { sites, totalBytes } = summarizeAllocationProfile(
      allocProfile,
      PROJECT_ROOT,
    );
    console.log(
      `\n--- Top allocating functions (game phase, sampled; ` +
        `~${fmtMB(totalBytes)} MB total incl. collected) ---`,
    );
    console.log(
      table(
        ["alloc MB", "%", "function", "location"],
        sites
          .slice(0, opts.top)
          .map((s) => [
            fmtMB(s.selfBytes),
            s.selfPct.toFixed(1),
            s.functionName,
            s.location,
          ]),
      ),
    );

    const outDir = path.join(PROJECT_ROOT, "tests/perf/output");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(
      outDir,
      `fullgame-${opts.map.replace(/\W+/g, "_")}-${opts.seed}.heapprofile`,
    );
    fs.writeFileSync(outFile, JSON.stringify(allocProfile));
    console.log(
      `Heap profile written to ${path.relative(PROJECT_ROOT, outFile)}` +
        ` (open in Chrome DevTools > Memory > Allocation sampling)`,
    );
  }

  if (profile) {
    console.log(`\n--- Top functions by self time (V8 sampling profiler) ---`);
    const fns = summarizeCpuProfile(profile, PROJECT_ROOT);
    console.log(
      table(
        ["self ms", "%", "function", "location"],
        fns
          .slice(0, opts.top)
          .map((f) => [
            fmtMs(f.selfMs),
            f.selfPct.toFixed(1),
            f.functionName,
            f.location,
          ]),
      ),
    );

    const outDir = path.join(PROJECT_ROOT, "tests/perf/output");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(
      outDir,
      `fullgame-${opts.map.replace(/\W+/g, "_")}-${opts.seed}.cpuprofile`,
    );
    fs.writeFileSync(outFile, JSON.stringify(profile));
    console.log(
      `\nCPU profile written to ${path.relative(PROJECT_ROOT, outFile)}` +
        ` (open in Chrome DevTools > Performance for a flame graph)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
