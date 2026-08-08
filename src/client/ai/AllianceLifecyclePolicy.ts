import {
  planAllianceLifecycleRust,
  preloadRustAllianceAi,
} from "../rust/OpenFrontWasmAllianceAi";
import { OpponentChoice, OpponentForecast } from "./OpponentForecastPolicy";

export type AllianceLifecycleAction =
  "keep" | "renew" | "do-not-renew" | "break";

export type AllianceLifecyclePlan = {
  action: AllianceLifecycleAction;
  reason: string;
  safeElimination: boolean;
};

void preloadRustAllianceAi();

export function planAllianceLifecycle({
  isSameTeam,
  otherIsTraitor,
  sharesBorder,
  ticksUntilExpiry,
  betrayalPenaltyTicks,
  inExtensionWindow,
  ownReserveRatio,
  otherReserveRatio,
  troopRatio,
  capacityRatio,
  territoryRatio,
  allianceCount,
  hostileNationBorders,
  activeNationWars,
  incomingFronts,
  cooperationReliability = 0.5,
  cooperationConfidence = 0,
  shouldReplaceUncooperativeAlly = false,
  replacementAvailable = false,
  otherPlayersAlive = Number.POSITIVE_INFINITY,
  forecast,
}: {
  isSameTeam: boolean;
  otherIsTraitor: boolean;
  sharesBorder: boolean;
  ticksUntilExpiry: number;
  betrayalPenaltyTicks: number;
  inExtensionWindow: boolean;
  ownReserveRatio: number;
  otherReserveRatio: number;
  troopRatio: number;
  capacityRatio: number;
  territoryRatio: number;
  allianceCount: number;
  hostileNationBorders: number;
  activeNationWars: number;
  incomingFronts: number;
  cooperationReliability?: number;
  cooperationConfidence?: number;
  shouldReplaceUncooperativeAlly?: boolean;
  replacementAvailable?: boolean;
  otherPlayersAlive?: number;
  forecast?: Pick<
    OpponentForecast,
    "predictedChoice" | "threat" | "confidence"
  >;
}): AllianceLifecyclePlan {
  const rust = planAllianceLifecycleRust({
    isSameTeam,
    otherIsTraitor,
    sharesBorder,
    ticksUntilExpiry,
    betrayalPenaltyTicks,
    inExtensionWindow,
    ownReserveRatio,
    otherReserveRatio,
    troopRatio,
    capacityRatio,
    territoryRatio,
    allianceCount,
    hostileNationBorders,
    activeNationWars,
    incomingFronts,
    cooperationReliability,
    cooperationConfidence,
    shouldReplaceUncooperativeAlly,
    replacementAvailable,
    otherPlayersAlive,
    forecast,
  });
  if (rust !== null) return rust;

  if (isSameTeam) {
    return {
      action: inExtensionWindow ? "renew" : "keep",
      reason: "team membership is permanent strategic cooperation",
      safeElimination: false,
    };
  }

  const predictedChoice: OpponentChoice = forecast?.predictedChoice ?? "bank";
  const futureThreat =
    (forecast?.threat ?? 0) *
    (predictedChoice === "expand" || predictedChoice === "economy" ? 1.15 : 1);
  const weakNeighbor =
    sharesBorder &&
    otherReserveRatio <= 0.2 &&
    troopRatio <= 0.18 &&
    capacityRatio <= 0.28 &&
    territoryRatio <= 0.18;
  const safeElimination =
    weakNeighbor &&
    ownReserveRatio >= 0.78 &&
    troopRatio <= 0.12 &&
    capacityRatio <= 0.2 &&
    territoryRatio <= 0.12 &&
    incomingFronts === 0 &&
    activeNationWars === 0 &&
    hostileNationBorders <= 1;
  const allianceStillUseful =
    incomingFronts > 0 ||
    hostileNationBorders + activeNationWars >= 2 ||
    troopRatio >= 0.65 ||
    capacityRatio >= 0.7 ||
    territoryRatio >= 0.65 ||
    futureThreat >= 0.75;
  const blocksGrowth =
    sharesBorder &&
    (weakNeighbor ||
      (troopRatio < 0.4 &&
        capacityRatio < 0.5 &&
        territoryRatio < 0.45 &&
        allianceCount > 1));

  if (otherIsTraitor && safeElimination) {
    return {
      action: "break",
      reason:
        "the ally is already a traitor and is a safely finishable bordering remnant",
      safeElimination,
    };
  }
  const finalOpponent = otherPlayersAlive === 1;
  if (
    finalOpponent &&
    incomingFronts === 0 &&
    activeNationWars === 0 &&
    hostileNationBorders === 0 &&
    ownReserveRatio >= 0.9 &&
    futureThreat <= 0.85 &&
    troopRatio <= 0.9
  ) {
    return {
      action: "break",
      reason:
        "this ally is the only remaining opponent and our full reserve has the stronger forecast; keeping the pact would make victory impossible",
      safeElimination: true,
    };
  }
  if (finalOpponent && inExtensionWindow) {
    return {
      action: "do-not-renew",
      reason:
        "this ally is the only remaining opponent, so another extension would indefinitely postpone the final contest",
      safeElimination: false,
    };
  }
  if (
    shouldReplaceUncooperativeAlly &&
    replacementAvailable &&
    cooperationConfidence >= 0.5 &&
    incomingFronts === 0 &&
    activeNationWars <= 1
  ) {
    return {
      action: "do-not-renew",
      reason:
        "repeated coordination requests were ignored while a viable replacement partner is available",
      safeElimination,
    };
  }
  if (
    inExtensionWindow &&
    cooperationConfidence >= 0.5 &&
    cooperationReliability < 0.34 &&
    incomingFronts === 0 &&
    hostileNationBorders + activeNationWars <= 1
  ) {
    return {
      action: "do-not-renew",
      reason:
        "the ally has not reciprocated requests or shared-front pressure enough to justify another alliance term",
      safeElimination,
    };
  }
  if (
    safeElimination &&
    ticksUntilExpiry > betrayalPenaltyTicks * 2 + 100 &&
    hostileNationBorders === 0 &&
    futureThreat < 0.6
  ) {
    return {
      action: "break",
      reason:
        "waiting for expiry would preserve a harmless remnant for too long, while no other hostile front can punish the traitor window",
      safeElimination,
    };
  }
  if (
    blocksGrowth &&
    incomingFronts === 0 &&
    activeNationWars <= 1 &&
    hostileNationBorders <= 1
  ) {
    return {
      action: "do-not-renew",
      reason:
        "the weak bordering ally blocks a low-risk expansion route; clean expiry avoids the traitor penalty",
      safeElimination,
    };
  }
  if (
    futureThreat >= 1.15 &&
    predictedChoice !== "defend" &&
    incomingFronts === 0 &&
    activeNationWars <= 1 &&
    hostileNationBorders <= 1
  ) {
    return {
      action: "do-not-renew",
      reason:
        "the ally's projected growth would turn it into a dangerous permanent neighbor after renewal",
      safeElimination,
    };
  }
  if (inExtensionWindow && allianceStillUseful) {
    return {
      action: "renew",
      reason:
        "the alliance still closes a meaningful front or preserves a comparable partner",
      safeElimination,
    };
  }
  if (inExtensionWindow) {
    return {
      action: "do-not-renew",
      reason:
        "the alliance no longer offsets an alliance slot or blocked expansion route",
      safeElimination,
    };
  }
  return {
    action: "keep",
    reason: "the alliance is useful now and does not need an extension yet",
    safeElimination,
  };
}
