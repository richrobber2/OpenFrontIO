import {
  allianceResponseWindowTicksRust,
  assessAllianceCooperationRust,
  preloadRustAllianceAi,
} from "../rust/OpenFrontWasmAllianceAi";

export interface AllianceCooperationContext {
  requestsAnswered: number;
  ignoredRequests: number;
  sharedFrontSamples: number;
  sharedFrontResponses: number;
  unpromptedAidEvents: number;
  allianceAgeRatio: number;
}

export interface AllianceCooperationAssessment {
  reliability: number;
  confidence: number;
  trusted: boolean;
  shouldReplace: boolean;
  reason: string;
}

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

void preloadRustAllianceAi();

/**
 * Measures whether an ally responds to explicit requests or independently
 * applies pressure on a shared front. Confidence grows with resolved requests
 * and observations, so one missed message cannot condemn a new alliance.
 */
export function assessAllianceCooperation(
  context: AllianceCooperationContext,
): AllianceCooperationAssessment {
  const rust = assessAllianceCooperationRust(context);
  if (rust !== null) return rust;

  const resolvedRequests = context.requestsAnswered + context.ignoredRequests;
  const requestResponseRate =
    resolvedRequests === 0 ? 0.5 : context.requestsAnswered / resolvedRequests;
  const sharedFrontResponseRate =
    context.sharedFrontSamples === 0
      ? 0.5
      : context.sharedFrontResponses / context.sharedFrontSamples;
  const aidBonus = Math.min(0.18, context.unpromptedAidEvents * 0.06);
  const confidence = clamp(
    resolvedRequests / 3 +
      context.sharedFrontSamples / 12 +
      clamp(context.allianceAgeRatio) * 0.12,
  );
  const reliability = clamp(
    0.5 +
      (requestResponseRate - 0.5) * 0.58 +
      (sharedFrontResponseRate - 0.5) * 0.34 +
      aidBonus,
  );
  const trusted =
    reliability >= 0.58 &&
    (confidence >= 0.25 || context.unpromptedAidEvents > 0);
  const shouldReplace =
    resolvedRequests >= 2 &&
    context.ignoredRequests >= 2 &&
    confidence >= 0.5 &&
    reliability < 0.34;

  return {
    reliability,
    confidence,
    trusted,
    shouldReplace,
    reason: shouldReplace
      ? "repeated requests were ignored and shared-front pressure stayed low"
      : trusted
        ? "the ally responds or applies useful pressure on shared fronts"
        : "the alliance still needs more cooperation evidence",
  };
}

/**
 * Gives allies a response window proportional to the configured alliance
 * lifetime while respecting the game's quick-chat cadence.
 */
export function allianceResponseWindowTicks({
  quickChatCooldownTicks,
  allianceDurationTicks,
}: {
  quickChatCooldownTicks: number;
  allianceDurationTicks: number;
}): number {
  const rust = allianceResponseWindowTicksRust(
    quickChatCooldownTicks,
    allianceDurationTicks,
  );
  if (rust !== null) return rust;
  return Math.ceil(
    Math.max(
      Math.max(1, quickChatCooldownTicks) * 4,
      Math.max(1, allianceDurationTicks) * 0.04,
    ),
  );
}
