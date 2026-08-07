import { OpenFrontWasmModule } from "../../client/rust/OpenFrontWasmModule";
import type { OpenFrontRustMap } from "../../client/rust/OpenFrontRustMap";
import type { Game } from "../game/Game";
import type { GameMap, TileRef } from "../game/GameMap";

interface RustPathfindingState {
  module: OpenFrontWasmModule;
  map: OpenFrontRustMap;
  landCount: number;
  railQueries: number;
  rebuilds: number;
  failures: number;
}

const states = new WeakMap<Game, RustPathfindingState>();
const failedGames = new WeakSet<Game>();

function snapshotTerrain(map: GameMap): Uint8Array {
  const terrain = new Uint8Array(map.width() * map.height());
  for (let tile = 0; tile < terrain.length; tile++) {
    terrain[tile] = map.terrainByte(tile);
  }
  return terrain;
}

function createRustMap(module: OpenFrontWasmModule, map: GameMap): OpenFrontRustMap {
  return module.createMap(map.width(), map.height(), snapshotTerrain(map));
}

function install(game: Game, module: OpenFrontWasmModule): void {
  const previous = states.get(game);
  previous?.map.dispose();

  const miniMap = game.miniMap();
  states.set(game, {
    module,
    map: createRustMap(module, miniMap),
    landCount: miniMap.numLandTiles(),
    railQueries: 0,
    rebuilds: 0,
    failures: 0,
  });
}

/**
 * Initializes the Rust pathfinding mirror used by the deterministic simulation
 * worker. Failure is deliberately non-fatal: gameplay continues through the
 * TypeScript fallback.
 */
export async function initializeRustPathfinding(
  game: Game,
  wasmUrl: string,
): Promise<boolean> {
  if (states.has(game)) return true;
  if (failedGames.has(game)) return false;

  try {
    const module = await OpenFrontWasmModule.load(wasmUrl);
    install(game, module);
    const miniMap = game.miniMap();
    console.info(
      `[RustPathfinding] live rail enabled on ${miniMap.width()}x${miniMap.height()} mini-map`,
    );
    return true;
  } catch (error) {
    failedGames.add(game);
    console.warn("[RustPathfinding] unavailable; using TypeScript rail fallback", error);
    return false;
  }
}

/** Test/headless entrypoint that avoids HTTP and installs the exact same service. */
export async function initializeRustPathfindingFromBytes(
  game: Game,
  wasmBytes: Uint8Array<ArrayBufferLike>,
): Promise<void> {
  const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
  install(game, module);
}

function ensureFresh(game: Game, state: RustPathfindingState): void {
  const miniMap = game.miniMap();
  const currentLandCount = miniMap.numLandTiles();
  if (currentLandCount === state.landCount) return;

  const replacement = createRustMap(state.module, miniMap);
  state.map.dispose();
  state.map = replacement;
  state.landCount = currentLandCount;
  state.rebuilds++;
  console.info(
    `[RustPathfinding] rebuilt rail mirror after mini-map terrain change (${state.rebuilds})`,
  );
}

/**
 * Returns undefined when Rust is unavailable or fails, so callers can fall
 * back to the authoritative TypeScript implementation. An empty array means
 * Rust ran successfully and found no route.
 */
export function rustRailPath(
  game: Game,
  starts: readonly TileRef[],
  goal: TileRef,
): TileRef[] | undefined {
  const state = states.get(game);
  if (!state) return undefined;

  try {
    ensureFresh(game, state);
    const path = state.map.railPath(Uint32Array.from(starts), goal);
    state.railQueries++;
    return Array.from(path) as TileRef[];
  } catch (error) {
    state.failures++;
    // A deterministic TS fallback is safer than killing a match if the Wasm
    // module encounters a runtime/environment problem.
    if (state.failures <= 3) {
      console.warn(
        `[RustPathfinding] rail query failed; falling back to TypeScript (failure ${state.failures})`,
        error,
      );
    }
    return undefined;
  }
}

export interface RustPathfindingStats {
  enabled: boolean;
  railQueries: number;
  rebuilds: number;
  failures: number;
}

export function rustPathfindingStats(game: Game): RustPathfindingStats {
  const state = states.get(game);
  return state
    ? {
        enabled: true,
        railQueries: state.railQueries,
        rebuilds: state.rebuilds,
        failures: state.failures,
      }
    : { enabled: false, railQueries: 0, rebuilds: 0, failures: 0 };
}

export function disposeRustPathfinding(game: Game): void {
  const state = states.get(game);
  if (!state) return;
  state.map.dispose();
  states.delete(game);
}
