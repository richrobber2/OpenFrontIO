import { placeName, placeSpawnName } from "../client/hud/NameBoxCalculator";
import { Config } from "./configuration/Config";
import { DoomsdayClockExecution } from "./execution/DoomsdayClockExecution";
import { Executor } from "./execution/ExecutionManager";
import { RecomputeRailClusterExecution } from "./execution/RecomputeRailClusterExecution";
import { SpawnTimerExecution } from "./execution/SpawnTimerExecution";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import {
  AllPlayers,
  BuildableUnit,
  Game,
  GameType,
  GameUpdates,
  NameViewData,
  Player,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  UnitType,
} from "./game/Game";
import { createGame } from "./game/GameImpl";
import { TileRef } from "./game/GameMap";
import { GameMapLoader } from "./game/GameMapLoader";
import { ErrorUpdate, GameUpdateViewData } from "./game/GameUpdates";
import { createNationsForGame } from "./game/NationCreation";
import { loadTerrainMap as loadGameMap } from "./game/TerrainMapLoader";
import { PseudoRandom } from "./PseudoRandom";
import { ClientID, GameStartInfo, Turn } from "./Schemas";
import { simpleHash } from "./Util";

const NAME_PLACEMENT_REFRESH_TICKS = 30;

export async function createGameRunner(
  gameStart: GameStartInfo,
  clientID: ClientID | undefined,
  mapLoader: GameMapLoader,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  const config = new Config(gameStart.config, null, false, gameStart.listed);
  const gameMap = await loadGameMap(
    gameStart.config.gameMap,
    gameStart.config.gameMapSize,
    mapLoader,
    false, // Worker never renders layers — skip image loading to save memory.
  );
  const random = new PseudoRandom(simpleHash(gameStart.gameID));

  const humans = gameStart.players.map((p) => {
    return new PlayerInfo(
      p.username,
      PlayerType.Human,
      p.clientID,
      random.nextID(),
      p.isLobbyCreator ?? false,
      p.clanTag,
      p.friends ?? [],
      p.teamIndex ?? null,
    );
  });

  const nations = createNationsForGame(
    gameStart,
    gameMap.nations,
    gameMap.additionalNations,
    humans.length,
    random,
  );

  const game: Game = createGame(
    humans,
    nations,
    gameMap.gameMap,
    gameMap.miniGameMap,
    config,
    gameMap.teamGameSpawnAreas,
  );

  const gr = new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      clientID,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
  );
  gr.init();
  return gr;
}

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  ) {}

  init() {
    if (this.game.config().gameConfig().gameType !== GameType.Singleplayer) {
      this.game.addExecution(new SpawnTimerExecution());
    }
    if (this.game.config().spawnNations()) {
      this.game.addExecution(...this.execManager.nationExecutions());
    }
    if (this.game.config().isRandomSpawn()) {
      this.game.addExecution(...this.execManager.spawnPlayers());
    }
    if (this.game.config().bots() > 0) {
      this.game.addExecution(
        ...this.execManager.spawnTribes(this.game.config().bots()),
      );
    }
    this.game.addExecution(new WinCheckExecution());
    if (this.game.config().doomsdayClockConfig().enabled) {
      this.game.addExecution(new DoomsdayClockExecution());
    }
    if (!this.game.config().isUnitDisabled(UnitType.Factory)) {
      this.game.addExecution(
        new RecomputeRailClusterExecution(this.game.railNetwork()),
      );
    }
  }

  public addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  public executeNextTick(pendingTurns?: number): boolean {
    if (this.isExecuting) {
      return false;
    }
    if (this.currTurn >= this.turns.length) {
      return false;
    }
    this.isExecuting = true;

    this.game.addExecution(
      ...this.execManager.createExecs(this.turns[this.currTurn]),
    );
    this.currTurn++;

    const wasInSpawnPhase = this.game.inSpawnPhase();
    let updates: GameUpdates;
    let tickExecutionDuration: number;

    try {
      const startTime = performance.now();
      updates = this.game.executeNextTick();
      const endTime = performance.now();
      tickExecutionDuration = endTime - startTime;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Game tick error:", error.message);
        this.callBack({
          errMsg: error.message,
          stack: error.stack,
        } as ErrorUpdate);
      } else {
        console.error("Game tick error:", error);
      }
      this.isExecuting = false;
      return false;
    }

    // Send only placements calculated this tick. Periodic work is distributed
    // across the refresh window so hundreds of players do not create a single
    // simulation and structured-clone spike every 30th tick.
    const playerNameViewData: Record<PlayerID, NameViewData> = {};
    let viewDataChanged = false;
    const recordName = (player: Player, data: NameViewData) => {
      playerNameViewData[player.id()] = data;
      viewDataChanged = true;
    };
    if (this.game.inSpawnPhase()) {
      for (const p of this.game.players()) {
        if (p.type() !== PlayerType.Human && p.type() !== PlayerType.Nation) {
          continue;
        }
        if (p.spawnTile() === undefined) continue;
        recordName(p, placeSpawnName(this.game, p));
      }
    }

    const spawnJustEnded = wasInSpawnPhase && !this.game.inSpawnPhase();
    if (spawnJustEnded || this.game.ticks() < 3) {
      for (const p of this.game.players()) {
        recordName(p, placeName(this.game, p));
      }
    } else if (!this.game.inSpawnPhase()) {
      const players = this.game.players();
      const bucket = this.game.ticks() % NAME_PLACEMENT_REFRESH_TICKS;
      for (
        let index = bucket;
        index < players.length;
        index += NAME_PLACEMENT_REFRESH_TICKS
      ) {
        const player = players[index];
        recordName(player, placeName(this.game, player));
      }
    }

    const packedTileUpdates = this.game.drainPackedTileUpdates();
    const packedMotionPlans = this.game.drainPackedMotionPlans();
    const packedPlayerUpdates = this.game.drainPackedPlayerUpdates();
    const packedAttackUpdates = this.game.drainPackedAttackUpdates();
    const nukeImpactTiles = this.game.drainNukeImpacts();
    const packedNukeImpacts =
      nukeImpactTiles.length > 0 ? new Uint32Array(nukeImpactTiles) : undefined;

    this.callBack({
      tick: this.game.ticks(),
      packedTileUpdates,
      ...(packedMotionPlans ? { packedMotionPlans } : {}),
      ...(packedPlayerUpdates ? { packedPlayerUpdates } : {}),
      ...(packedAttackUpdates ? { packedAttackUpdates } : {}),
      ...(packedNukeImpacts ? { packedNukeImpacts } : {}),
      updates: updates,
      ...(viewDataChanged ? { playerNameViewData } : {}),
      tickExecutionDuration: tickExecutionDuration,
      pendingTurns: pendingTurns ?? 0,
    });
    this.isExecuting = false;
    return true;
  }

  public pendingTurns(): number {
    return Math.max(0, this.turns.length - this.currTurn);
  }

  public playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[] {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    return player.buildableUnits(tile, units);
  }

  public playerActions(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): PlayerActions {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    const actions = {
      canAttack: tile !== null && player.canAttack(tile),
      buildableUnits: units === null ? [] : player.buildableUnits(tile, units),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
      canEmbargoAll: player.canEmbargoAll(),
    } as PlayerActions;

    if (tile !== null && this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        sharedBorder: player.sharesBorderWith(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canBreakAlliance: player.isAlliedWith(other),
        canDonateGold: player.canDonateGold(other),
        canDonateTroops: player.canDonateTroops(other),
        canEmbargo: !player.hasEmbargoAgainst(other),
        allianceInfo: player.allianceInfo(other) ?? undefined,
      };
    }

    return actions;
  }

  public playerProfile(playerID: number): PlayerProfile {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.playerProfile();
  }
  public playerBorderTiles(playerID: PlayerID): PlayerBorderTiles {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return {
      // Copy into a plain Set: this result crosses the worker boundary via
      // structured clone, which TileSet does not survive.
      borderTiles: new Set(player.borderTiles()),
    } as PlayerBorderTiles;
  }

  public attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): { id: string; positions: { x: number; y: number }[] }[] {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer())
      throw new Error(`player with id ${playerID} not found`);
    const all = [...player.outgoingAttacks(), ...player.incomingAttacks()];
    const attacks = attackID ? all.filter((a) => a.id() === attackID) : all;

    return attacks.map((a) => ({
      id: a.id(),
      positions: a.clusteredPositions().map((tile) => ({
        x: this.game.map().x(tile),
        y: this.game.map().y(tile),
      })),
    }));
  }

  public bestTransportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): TileRef | false {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.bestTransportShipSpawn(targetTile);
  }
}
