export const MAX_TRADE_SHIP_LIGHTS = 2_048;
export const TRADE_SHIP_LIGHT_CELL_SIZE = 4;

export function shouldEmitTradeShipLight(
  occupiedCells: Set<number>,
  x: number,
  y: number,
  mapWidth: number,
  emittedLights: number,
  maximumLights = MAX_TRADE_SHIP_LIGHTS,
  cellSize = TRADE_SHIP_LIGHT_CELL_SIZE,
): boolean {
  if (emittedLights >= maximumLights) return false;
  const safeCellSize = Math.max(1, Math.floor(cellSize));
  const cellsPerRow = Math.ceil(Math.max(1, mapWidth) / safeCellSize);
  const key =
    Math.floor(y / safeCellSize) * cellsPerRow + Math.floor(x / safeCellSize);
  if (occupiedCells.has(key)) return false;
  occupiedCells.add(key);
  return true;
}
