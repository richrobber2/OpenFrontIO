export interface ContestedTribeOpportunityContext {
  targetUnderAttack: boolean;
  targetIncomingTroops: number;
  ownTroops: number;
  maxTroops: number;
  reserveFloor: number;
  incomingFronts: number;
  outgoingFronts: number;
  maximumFronts: number;
  alreadyAttackingTarget: boolean;
  targetTroops: number;
  terrainLossCost: number;
  wrapPotential: number;
}

export interface ContestedTribeOpportunityPlan {
  attack: boolean;
  fraction: number;
  projectedReserveRatio: number;
  pressureRatio: number;
  effectiveTargetCost: number;
  reason: string;
}

const reject = (
  reserveRatio: number,
  reason: string,
): ContestedTribeOpportunityPlan => ({
  attack: false,
  fraction: 0,
  projectedReserveRatio: Math.max(0, reserveRatio),
  pressureRatio: 0,
  effectiveTargetCost: 0,
  reason,
});

/**
 * A tribe already under attack is a perishable growth opportunity. Join the
 * fight on the first legal planning pass while preserving the live home-reserve
 * floor. The third-party force lowers the effective finishing cost, but never
 * permits spending troops that the current reserve cannot safely release.
 */
export function planContestedTribeOpportunity(
  context: ContestedTribeOpportunityContext,
): ContestedTribeOpportunityPlan {
  const ownTroops = Math.max(0, context.ownTroops);
  const maxTroops = Math.max(1, context.maxTroops);
  const reserveRatio = Math.max(0, Math.min(1, ownTroops / maxTroops));
  if (!context.targetUnderAttack || context.targetIncomingTroops <= 0) {
    return reject(
      reserveRatio,
      "the tribe is not under active outside pressure",
    );
  }
  if (context.incomingFronts > 0) {
    return reject(reserveRatio, "home defense has first claim on troops");
  }
  if (context.alreadyAttackingTarget) {
    return reject(
      reserveRatio,
      "the tribe is already one of our active targets",
    );
  }
  if (context.outgoingFronts >= Math.max(1, context.maximumFronts)) {
    return reject(reserveRatio, "the active-front limit is already occupied");
  }

  const protectedReserve = Math.max(
    0.4,
    Math.min(0.78, Math.max(0, context.reserveFloor)),
  );
  const availableFraction =
    (reserveRatio - protectedReserve) / Math.max(0.01, reserveRatio);
  if (availableFraction < 0.03) {
    return reject(
      reserveRatio,
      "fewer than three percent of current troops are safely available",
    );
  }

  const targetTroops = Math.max(1, context.targetTroops);
  const pressureRatio = Math.min(
    1,
    Math.max(0, context.targetIncomingTroops) / targetTroops,
  );
  const terrainLossCost = Math.max(0.5, Math.min(2.5, context.terrainLossCost));
  const wrapPotential = Math.max(0, Math.min(1, context.wrapPotential));
  const effectiveTargetCost =
    targetTroops *
    terrainLossCost *
    (1 - wrapPotential * 0.3) *
    (1 - pressureRatio * 0.45);
  const desiredFraction = Math.max(
    0.06,
    Math.min(0.42, (effectiveTargetCost * 1.08) / Math.max(1, ownTroops)),
  );
  const fraction = Math.min(availableFraction, desiredFraction);
  if (fraction < 0.03) {
    return reject(
      reserveRatio,
      "the safe commitment is too small to establish a useful front",
    );
  }

  return {
    attack: true,
    fraction,
    projectedReserveRatio: reserveRatio * (1 - fraction),
    pressureRatio,
    effectiveTargetCost,
    reason:
      "another attacker has opened the tribe, so delaying risks losing its land and gold to somebody else",
  };
}
