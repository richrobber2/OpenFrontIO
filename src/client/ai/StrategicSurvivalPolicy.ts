export interface StrategicSurvivalContext {
  enemySiloCount: number;
  incomingStrategicWeapons: number;
  samCoverageRatio: number;
  criticalLandSamCoverageRatio?: number;
  criticalStructureClustering: number;
  recentBlastRisk: number;
  gold: number;
  samCost: number;
  activeAttackCommitmentRatio: number;
  reserveRatio: number;
  provokingNuclearNation?: boolean;
  projectedRetaliationLandLossRatio?: number;
  enemyMirvProgress?: number;
  estimatedTicksUntilEnemyMirv?: number;
  estimatedTicksToEliminateEnemy?: number;
  eliminationConfidence?: number;
}

export interface StrategicSurvivalDecision {
  buildSam: boolean;
  disperseCriticalStructures: boolean;
  reduceAttackCommitments: boolean;
  avoidRecentBlastArea: boolean;
  allowNuclearProvocation: boolean;
  mirvStrategy: "ignore" | "eliminate" | "avoid";
  emergencyGoldFloor: number;
  threatScore: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Keeps the AI alive once strategic weapons enter play. It also tracks whether
 * a rival is approaching MIRV capability and chooses a decisive response:
 * eliminate the rival before deployment, or avoid escalation and harden.
 */
export function evaluateStrategicSurvival(
  context: StrategicSurvivalContext,
): StrategicSurvivalDecision {
  const samCoverage = clamp(context.samCoverageRatio, 0, 1);
  const criticalCoverage = clamp(
    context.criticalLandSamCoverageRatio ?? samCoverage,
    0,
    1,
  );
  const clustering = clamp(context.criticalStructureClustering, 0, 1);
  const blastRisk = clamp(context.recentBlastRisk, 0, 1);
  const attackCommitment = clamp(context.activeAttackCommitmentRatio, 0, 1);
  const reserve = clamp(context.reserveRatio, 0, 1);
  const retaliationLoss = clamp(
    context.projectedRetaliationLandLossRatio ?? 0,
    0,
    1,
  );
  const mirvProgress = clamp(context.enemyMirvProgress ?? 0, 0, 1);
  const eliminationConfidence = clamp(context.eliminationConfidence ?? 0, 0, 1);
  const ticksUntilMirv = Math.max(
    0,
    context.estimatedTicksUntilEnemyMirv ?? Number.POSITIVE_INFINITY,
  );
  const ticksToEliminate = Math.max(
    0,
    context.estimatedTicksToEliminateEnemy ?? Number.POSITIVE_INFINITY,
  );

  const mirvThreat = mirvProgress >= 0.55 || ticksUntilMirv <= 900;
  const canFinishBeforeMirv =
    mirvThreat &&
    eliminationConfidence >= 0.72 &&
    ticksToEliminate + 120 < ticksUntilMirv &&
    reserve >= 0.5 &&
    criticalCoverage >= 0.65;
  const mirvStrategy: StrategicSurvivalDecision["mirvStrategy"] = !mirvThreat
    ? "ignore"
    : canFinishBeforeMirv
      ? "eliminate"
      : "avoid";

  const threatScore =
    context.enemySiloCount * 12 +
    context.incomingStrategicWeapons * 40 +
    clustering * 18 +
    blastRisk * 16 +
    mirvProgress * 38 +
    (ticksUntilMirv <= 600 ? 18 : 0) -
    samCoverage * 14 -
    criticalCoverage * 16;

  const provokingNuclearNation = context.provokingNuclearNation ?? false;
  const retaliationSurvivable =
    criticalCoverage >= (mirvThreat ? 0.82 : 0.72) &&
    retaliationLoss <= (mirvThreat ? 0.12 : 0.2) &&
    reserve >= (mirvThreat ? 0.58 : 0.45);
  const allowNuclearProvocation =
    !provokingNuclearNation ||
    mirvStrategy === "eliminate" ||
    retaliationSurvivable;

  const samReserveMultiplier = mirvThreat ? 2.25 : 1.25;
  const emergencyGoldFloor =
    context.enemySiloCount > 0 ||
    context.incomingStrategicWeapons > 0 ||
    mirvThreat
      ? context.samCost * samReserveMultiplier
      : context.samCost * 0.5;

  const requiredCoverage = mirvThreat ? 0.85 : 0.7;
  const buildSam =
    threatScore >= 12 &&
    criticalCoverage < requiredCoverage &&
    context.gold >= context.samCost;

  const disperseCriticalStructures = clustering >= 0.45 && threatScore >= 10;
  const reduceAttackCommitments =
    context.incomingStrategicWeapons > 0 ||
    mirvStrategy === "avoid" ||
    (!allowNuclearProvocation && provokingNuclearNation) ||
    (threatScore >= 28 && (attackCommitment > 0.45 || reserve < 0.45));
  const avoidRecentBlastArea = blastRisk >= 0.35;

  let reason = "strategic threat is currently manageable";
  if (context.incomingStrategicWeapons > 0) {
    reason = "an incoming strategic strike requires immediate survival actions";
  } else if (mirvStrategy === "eliminate") {
    reason = "the rival can be eliminated before MIRV deployment, so commit decisively";
  } else if (mirvStrategy === "avoid") {
    reason = "the rival is approaching MIRV capability and cannot be safely finished in time";
  } else if (!allowNuclearProvocation) {
    reason = "provoking this nuclear nation risks unacceptable retaliation losses";
  } else if (buildSam) {
    reason = "enemy strategic capability justifies additional SAM coverage";
  } else if (disperseCriticalStructures) {
    reason = "critical structures are too concentrated for the current threat";
  }

  return {
    buildSam,
    disperseCriticalStructures,
    reduceAttackCommitments,
    avoidRecentBlastArea,
    allowNuclearProvocation,
    mirvStrategy,
    emergencyGoldFloor,
    threatScore,
    reason,
  };
}
