export type EmbargoResponseAction =
  | "ignore"
  | "warn"
  | "counter-embargo"
  | "economic-strike"
  | "prepare-war";

export interface EmbargoResponseContext {
  embargoActive: boolean;
  ticksSinceEmbargoStarted: number;
  ticksSinceLastWarning: number;
  ownEconomicDamageRatio: number;
  ownReserveRatio: number;
  ownActiveWars: number;
  enemyPowerRatioToSelf: number;
  enemyNuclearCapability: number;
  enemyMirvProgress: number;
  criticalLandSamCoverage: number;
  projectedRetaliationLandLoss: number;
  enemyTradeDependence: number;
  enemyEconomicTargetValue: number;
  canCounterEmbargo: boolean;
  canReachEconomicTargets: boolean;
}

export interface EmbargoResponseDecision {
  action: EmbargoResponseAction;
  commitmentRatio: number;
  reason: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const EMBARGO_WARNING_COOLDOWN_TICKS = 240;

/**
 * Treats an embargo as hostile economic pressure. The AI warns first, then
 * applies proportional economic retaliation while avoiding suicidal escalation.
 */
export function chooseEmbargoResponse(
  context: EmbargoResponseContext,
): EmbargoResponseDecision {
  if (!context.embargoActive) {
    return { action: "ignore", commitmentRatio: 0, reason: "no embargo is active" };
  }

  const damage = clamp(context.ownEconomicDamageRatio, 0, 1);
  const enemyPower = Math.max(0, context.enemyPowerRatioToSelf);
  const nuclearRisk = clamp(
    Math.max(context.enemyNuclearCapability, context.enemyMirvProgress),
    0,
    1,
  );
  const retaliationLoss = clamp(context.projectedRetaliationLandLoss, 0, 1);
  const samCoverage = clamp(context.criticalLandSamCoverage, 0, 1);

  const dangerousEscalation =
    enemyPower > 1.35 ||
    (nuclearRisk >= 0.6 && (samCoverage < 0.75 || retaliationLoss > 0.16));

  if (
    context.ticksSinceLastWarning >= EMBARGO_WARNING_COOLDOWN_TICKS &&
    context.ticksSinceEmbargoStarted < 480
  ) {
    return {
      action: "warn",
      commitmentRatio: 0,
      reason: "demand that the embargo be lifted before applying retaliation",
    };
  }

  if (dangerousEscalation) {
    if (context.canCounterEmbargo && context.enemyTradeDependence >= 0.25) {
      return {
        action: "counter-embargo",
        commitmentRatio: 0,
        reason: "answer economically without provoking an unsafe military escalation",
      };
    }
    return {
      action: "ignore",
      commitmentRatio: 0,
      reason: "the embargo hurts less than an unsafe escalation would",
    };
  }

  if (
    context.canCounterEmbargo &&
    context.enemyTradeDependence >= 0.35 &&
    damage < 0.18
  ) {
    return {
      action: "counter-embargo",
      commitmentRatio: 0,
      reason: "apply proportional trade pressure against the embargoing nation",
    };
  }

  if (
    context.canReachEconomicTargets &&
    context.enemyEconomicTargetValue >= 0.45 &&
    context.ownReserveRatio >= 0.58 &&
    context.ownActiveWars <= 1
  ) {
    const commitmentRatio = clamp(
      0.12 + damage * 0.22 + context.enemyEconomicTargetValue * 0.08,
      0.12,
      0.32,
    );
    return {
      action: "economic-strike",
      commitmentRatio,
      reason: "punish the embargo by attacking high-value economic targets",
    };
  }

  if (
    damage >= 0.25 &&
    context.ownReserveRatio >= 0.7 &&
    context.ownActiveWars === 0 &&
    enemyPower <= 1.05
  ) {
    return {
      action: "prepare-war",
      commitmentRatio: 0.25,
      reason: "persistent severe economic warfare justifies preparing a limited war",
    };
  }

  return {
    action: "warn",
    commitmentRatio: 0,
    reason: "maintain pressure for the embargo to be lifted without overcommitting",
  };
}
