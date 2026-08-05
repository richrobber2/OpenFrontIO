export interface WildernessExpansionContext {
  hasNeutralLand: boolean;
  reserveRatio: number;
  reserveFloor: number;
  incomingFronts: number;
  outgoingFronts: number;
  maximumFronts: number;
  wildernessAttackActive: boolean;
}

export interface WildernessExpansionPlan {
  attack: boolean;
  fraction: number;
  projectedReserveRatio: number;
  reason: string;
}

const reject = (
  reserveRatio: number,
  reason: string,
): WildernessExpansionPlan => ({
  attack: false,
  fraction: 0,
  projectedReserveRatio: Math.max(0, reserveRatio),
  reason,
});

/**
 * Neutral land has no defending army, so every avoidable delay wastes troop
 * regeneration and future capacity. Launch immediately once a useful force can
 * be sent without crossing the live front reserve floor.
 */
export function planWildernessExpansion(
  context: WildernessExpansionContext,
): WildernessExpansionPlan {
  const reserveRatio = Math.max(0, Math.min(1, context.reserveRatio));
  if (!context.hasNeutralLand) {
    return reject(reserveRatio, "no adjacent wilderness is reachable");
  }
  if (context.incomingFronts > 0) {
    return reject(reserveRatio, "an incoming attack has first claim on troops");
  }
  if (context.wildernessAttackActive) {
    return reject(reserveRatio, "a wilderness expansion is already active");
  }
  if (context.outgoingFronts >= Math.max(1, context.maximumFronts)) {
    return reject(reserveRatio, "the current front limit is already occupied");
  }

  const protectedReserve = Math.max(
    0.4,
    Math.min(0.78, Math.max(0, context.reserveFloor)),
  );
  const availableFraction =
    (reserveRatio - protectedReserve) / Math.max(0.01, reserveRatio);
  const fraction = Math.min(0.35, Math.max(0, availableFraction));
  if (fraction < 0.04) {
    return reject(
      reserveRatio,
      "fewer than four percent of current troops are safely available",
    );
  }

  return {
    attack: true,
    fraction,
    projectedReserveRatio: reserveRatio * (1 - fraction),
    reason:
      "free land can be captured immediately while preserving the live reserve floor",
  };
}
