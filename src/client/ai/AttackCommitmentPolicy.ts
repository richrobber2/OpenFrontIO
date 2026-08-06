export interface AttackCommitmentContext {
  reserveRatio: number;
  reserveFloor: number;
  activeFronts: number;
  incomingTroopRatio: number;
  targetTroopRatio: number;
  estimatedConquestTicks: number;
  targetStrategicValue: number;
  isRetaliation: boolean;
}

export interface AttackCommitmentDecision {
  allowed: boolean;
  maxCommitFraction: number;
  reasons: string[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Caps attack size so the trainer cannot spend its last realistic chance of
 * survival on one optimistic offensive.
 */
export function assessAttackCommitment(
  context: AttackCommitmentContext,
): AttackCommitmentDecision {
  const reasons: string[] = [];
  const reserveMargin = context.reserveRatio - context.reserveFloor;

  let maxCommitFraction = clamp(
    reserveMargin / Math.max(0.01, context.reserveRatio),
    0,
    0.55,
  );

  if (context.activeFronts >= 2) {
    maxCommitFraction *= 0.65;
    reasons.push("multiple active fronts require a smaller commitment");
  }
  if (context.incomingTroopRatio >= 0.25) {
    maxCommitFraction *= 0.55;
    reasons.push("incoming pressure requires preserving troops");
  }
  if (context.estimatedConquestTicks > 420) {
    maxCommitFraction *= 0.7;
    reasons.push("long conquest estimate increases exposure");
  }
  if (context.targetTroopRatio > 0.7 && !context.isRetaliation) {
    maxCommitFraction *= 0.65;
    reasons.push("target remains too strong for a large proactive attack");
  }
  if (context.targetStrategicValue < 0.35 && !context.isRetaliation) {
    maxCommitFraction *= 0.75;
    reasons.push("low-value target does not justify heavy commitment");
  }

  const minimumUsefulCommitment = context.isRetaliation ? 0.08 : 0.12;
  const hardBlocked =
    reserveMargin <= 0 ||
    context.incomingTroopRatio >= 0.6 ||
    (!context.isRetaliation && context.activeFronts >= 3) ||
    (!context.isRetaliation && context.estimatedConquestTicks > 600);

  if (reserveMargin <= 0) reasons.push("reserve is already at or below its floor");
  if (context.incomingTroopRatio >= 0.6)
    reasons.push("incoming attack is an immediate survival threat");
  if (!context.isRetaliation && context.activeFronts >= 3)
    reasons.push("too many fronts are already open");
  if (!context.isRetaliation && context.estimatedConquestTicks > 600)
    reasons.push("proactive conquest would take too long");

  maxCommitFraction = clamp(maxCommitFraction, 0, 0.55);

  return {
    allowed: !hardBlocked && maxCommitFraction >= minimumUsefulCommitment,
    maxCommitFraction,
    reasons,
  };
}
