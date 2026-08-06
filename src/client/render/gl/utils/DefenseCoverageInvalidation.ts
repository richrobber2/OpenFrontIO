export interface BlockBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function defensePostBlockBounds(
  x: number,
  y: number,
  range: number,
  mapWidth: number,
  mapHeight: number,
  blockSize: number,
): BlockBounds {
  return {
    minX: Math.max(0, Math.floor((x - range) / blockSize)),
    minY: Math.max(0, Math.floor((y - range) / blockSize)),
    maxX: Math.min(
      Math.ceil(mapWidth / blockSize) - 1,
      Math.floor((x + range) / blockSize),
    ),
    maxY: Math.min(
      Math.ceil(mapHeight / blockSize) - 1,
      Math.floor((y + range) / blockSize),
    ),
  };
}
