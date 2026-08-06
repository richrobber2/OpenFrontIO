export interface BridgeheadAssessmentContext {
  projectedEnemyTroops: number;
  requiredLandingAdvantage: number;
  normalMinimumLaunchTroops: number;
  bridgeheadMinimumLaunchTroops: number;
  maximumLaunchTroops: number;
  reachGain: number;
  interceptionRisk: number;
  passableExits: number;
  targetIsTribe: boolean;
  targetIsRemnant: boolean;
}

export interface BridgeheadAssessment {
  launchTroops: number;
  bridgehead: boolean;
  reachValue: number;
  reason: string;
}

export interface LandGrabAssessmentContext {
  committedTroops: number;
  projectedEnemyTroops: number;
  currentEnemyTroops: number;
  targetTiles: number;
  expectedCapturedTiles: number;
  estimatedTicks: number;
  terrainLossMultiplier: number;
  retreatLossRatio?: number;
}

export interface LandGrabAssessment {
  worthwhile: boolean;
  expectedValue: number;
  expectedCost: number;
  projectedEnemyGrowth: number;
  projectedForceRatio: number;
  reason: string;
}

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

/**
 * A bridgehead is a cheap, survivable landing that materially shortens later
 * routes. It is not permission to send a token boat into a defended nation.
 */
export function assessBridgeheadLaunch(
  context: BridgeheadAssessmentContext,
): BridgeheadAssessment {
  const maximum = Math.max(0, Math.floor(context.maximumLaunchTroops));
  const projectedEnemyTroops = Math.max(0, context.projectedEnemyTroops);
  const required = Math.ceil(
    projectedEnemyTroops * Math.max(0, context.requiredLandingAdvantage) * 1.15,
  );
  const reachGain = clamp(context.reachGain);
  const bridgehead =
    (context.targetIsTribe || context.targetIsRemnant) &&
    reachGain >= 0.08 &&
    context.interceptionRisk <= 0.24 &&
    context.passableExits >= 2 &&
    required <= maximum &&
    required <= Math.max(1, context.normalMinimumLaunchTroops) * 0.75;
  const minimum = bridgehead
    ? Math.max(0, Math.ceil(context.bridgeheadMinimumLaunchTroops))
    : Math.max(0, Math.ceil(context.normalMinimumLaunchTroops));
  const launchTroops = required > maximum ? 0 : Math.max(minimum, required);
  const reachValue =
    bridgehead && launchTroops > 0
      ? reachGain * 100 + Math.min(12, context.passableExits * 2)
      : 0;
  return {
    launchTroops,
    bridgehead,
    reachValue,
    reason:
      launchTroops === 0
        ? "the projected defender cannot be beaten by the available transport force"
        : bridgehead
          ? "a small low-risk landing materially shortens future routes"
          : "the landing requires a normal conquest-sized transport",
  };
}

/**
 * Values a limited land grab against the defender it will actually face after
 * regenerating during the attack. Captured troop density and denied growth
 * must repay expected attrition and the engine's retreat loss.
 */
export function assessGrowthAwareLandGrab(
  context: LandGrabAssessmentContext,
): LandGrabAssessment {
  const committedTroops = Math.max(0, context.committedTroops);
  const projectedEnemyTroops = Math.max(0, context.projectedEnemyTroops);
  const currentEnemyTroops = Math.max(0, context.currentEnemyTroops);
  const projectedEnemyGrowth = Math.max(
    0,
    projectedEnemyTroops - currentEnemyTroops,
  );
  const capturedFraction = clamp(
    Math.max(0, context.expectedCapturedTiles) /
      Math.max(1, context.targetTiles),
  );
  const capturedLandValue = currentEnemyTroops * capturedFraction;
  const deniedGrowthValue =
    projectedEnemyGrowth * Math.min(0.7, 0.2 + capturedFraction * 3);
  const expectedValue = capturedLandValue + deniedGrowthValue;
  const terrainCost =
    committedTroops *
    Math.max(0.04, Math.min(0.45, 0.08 * context.terrainLossMultiplier));
  const retreatCost =
    committedTroops * Math.max(0, context.retreatLossRatio ?? 0.25);
  const timeCost =
    committedTroops *
    Math.min(0.18, Math.max(0, context.estimatedTicks) / 1_000);
  const expectedCost = terrainCost + retreatCost + timeCost;
  const projectedForceRatio =
    projectedEnemyTroops / Math.max(1, committedTroops);
  const worthwhile =
    committedTroops > 0 &&
    projectedForceRatio <= 1.35 &&
    expectedValue >= expectedCost * 1.08;
  return {
    worthwhile,
    expectedValue,
    expectedCost,
    projectedEnemyGrowth,
    projectedForceRatio,
    reason: worthwhile
      ? "captured land and denied regeneration repay projected attrition"
      : projectedForceRatio > 1.35
        ? "the defender will outgrow the limited force before the grab completes"
        : "the land and growth denial do not repay expected losses",
  };
}
