export interface TileMetric<T> {
  (tile: number): T;
  cachedTiles(): number;
}

export function memoizeTileMetric<T>(
  compute: (tile: number) => T,
): TileMetric<T> {
  const cache = new Map<number, T>();
  const metric = ((tile: number): T => {
    if (cache.has(tile)) return cache.get(tile)!;
    const value = compute(tile);
    cache.set(tile, value);
    return value;
  }) as TileMetric<T>;
  metric.cachedTiles = () => cache.size;
  return metric;
}
