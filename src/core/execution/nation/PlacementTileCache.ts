import { TileRef } from "../../game/GameMap";

/** Reuses an immutable placement snapshot unless a stacked tile must be omitted. */
export function placementTilesExcluding(
  tiles: Set<TileRef>,
  excluded: TileRef,
): Set<TileRef> {
  if (!tiles.has(excluded)) return tiles;
  const filtered = new Set(tiles);
  filtered.delete(excluded);
  return filtered;
}
