export type LandCapacityProjection = {
  currentLandCapacity: number;
  projectedLandCapacity: number;
  projectedMaxTroops: number;
  capacityGain: number;
  capacityGainPerTile: number;
  currentRegeneration: number;
  projectedRegeneration: number;
  regenerationMultiplier: number;
  worthwhile: boolean;
};

function safeTiles(tiles: number): number {
  return Math.max(0, tiles);
}

/** Mirrors Config.maxTroops' land term before city capacity is added. */
export function landTroopCapacity(
  tiles: number,
  playerCapacityMultiplier = 1,
): number {
  return (
    2 *
    (Math.pow(safeTiles(tiles), 0.6) * 1_000 + 50_000) *
    Math.max(0, playerCapacityMultiplier)
  );
}

/** Mirrors the human troop regeneration formula in Config.troopIncreaseRate. */
export function humanTroopRegeneration(
  troops: number,
  maxTroops: number,
): number {
  const safeMax = Math.max(1, maxTroops);
  const safeTroops = Math.max(0, troops);
  const base = 10 + Math.pow(safeTroops, 0.73) / 4;
  return Math.max(
    0,
    Math.min(safeTroops + base * (1 - safeTroops / safeMax), safeMax) -
      safeTroops,
  );
}

export function projectLandCapacity({
  currentTiles,
  projectedTiles,
  currentMaxTroops,
  currentTroops,
  playerCapacityMultiplier = 1,
}: {
  currentTiles: number;
  projectedTiles: number;
  currentMaxTroops: number;
  currentTroops: number;
  playerCapacityMultiplier?: number;
}): LandCapacityProjection {
  const currentLandCapacity = landTroopCapacity(
    currentTiles,
    playerCapacityMultiplier,
  );
  const projectedLandCapacity = landTroopCapacity(
    Math.max(currentTiles, projectedTiles),
    playerCapacityMultiplier,
  );
  const capacityGain = Math.max(0, projectedLandCapacity - currentLandCapacity);
  const gainedTiles = Math.max(0, projectedTiles - currentTiles);
  const projectedMaxTroops = Math.max(
    currentMaxTroops,
    currentMaxTroops + capacityGain,
  );
  const currentRegeneration = humanTroopRegeneration(
    currentTroops,
    currentMaxTroops,
  );
  const projectedRegeneration = humanTroopRegeneration(
    currentTroops,
    projectedMaxTroops,
  );
  const regenerationMultiplier =
    projectedRegeneration / Math.max(0.000_001, currentRegeneration);

  return {
    currentLandCapacity,
    projectedLandCapacity,
    projectedMaxTroops,
    capacityGain,
    capacityGainPerTile:
      gainedTiles <= 0 ? 0 : capacityGain / Math.max(1, gainedTiles),
    currentRegeneration,
    projectedRegeneration,
    regenerationMultiplier,
    worthwhile:
      capacityGain >= Math.max(500, currentMaxTroops * 0.01) &&
      regenerationMultiplier > 1.01,
  };
}
