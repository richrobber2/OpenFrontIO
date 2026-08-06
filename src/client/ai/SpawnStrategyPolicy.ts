export interface CoastalAccessSample {
  distance: number | null;
  openWaterDirections: number;
}

export function sampleCoastalAccess(context: {
  originX: number;
  originY: number;
  isValidCoord: (x: number, y: number) => boolean;
  tileAt: (x: number, y: number) => number;
  isOceanShore: (tile: number) => boolean;
  openWaterDirections: (tile: number) => number;
  maximumDistance?: number;
  directionCount?: number;
  step?: number;
}): CoastalAccessSample {
  const maximumDistance = Math.max(0, context.maximumDistance ?? 60);
  const directionCount = Math.max(4, context.directionCount ?? 16);
  const step = Math.max(1, context.step ?? 5);
  let best: CoastalAccessSample = {
    distance: null,
    openWaterDirections: 0,
  };

  for (let distance = 0; distance <= maximumDistance; distance += step) {
    for (let index = 0; index < directionCount; index++) {
      const angle = (index / directionCount) * Math.PI * 2;
      const x = Math.round(context.originX + Math.cos(angle) * distance);
      const y = Math.round(context.originY + Math.sin(angle) * distance);
      if (!context.isValidCoord(x, y)) continue;
      const tile = context.tileAt(x, y);
      if (!context.isOceanShore(tile)) continue;
      const openWaterDirections = Math.max(
        0,
        context.openWaterDirections(tile),
      );
      if (
        best.distance === null ||
        distance < best.distance ||
        (distance === best.distance &&
          openWaterDirections > best.openWaterDirections)
      ) {
        best = { distance, openWaterDirections };
      }
    }
    if (best.distance !== null) return best;
  }
  return best;
}

export function scoreTrainingSpawn(context: {
  neutralSpace: number;
  nearbyTribes: number;
  nationDistance: number;
  tribeDistance: number;
  tribeTroops: number;
  coastDistance: number | null;
  openWaterDirections: number;
}): number {
  const base =
    Math.max(0, context.neutralSpace) +
    Math.max(0, context.nearbyTribes) * 75 +
    Math.min(100, Math.max(0, context.nationDistance)) * 3 -
    Math.abs(context.tribeDistance - 13) * 4 -
    Math.log10(Math.max(1, context.tribeTroops)) * 3;
  if (context.coastDistance === null) return base - 90;

  const distance = Math.max(0, context.coastDistance);
  const idealDistance = 18;
  const distanceQuality = Math.max(
    0,
    1 - Math.abs(distance - idealDistance) / 42,
  );
  const crampedPenalty = distance < 6 ? (6 - distance) * 12 : 0;
  const seaAccess = Math.min(6, Math.max(0, context.openWaterDirections));
  return base + distanceQuality * 170 + seaAccess * 8 - crampedPenalty;
}
