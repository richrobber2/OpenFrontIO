import {
  planCommunicationRust,
  preloadRustAllianceAi,
} from "../rust/OpenFrontWasmAllianceAi";
import {
  AidRequestKind,
  chooseAidRequest,
  CoordinationContext,
  DonationContext,
  shouldCoordinateAttack,
  shouldDonateGold,
  shouldDonateTroops,
} from "./DiplomacyPolicy";

export type CommunicationAction =
  | {
      kind: "quick-chat";
      key:
        | "help.gold"
        | "help.troops"
        | "help.help_defend"
        | "attack.focus"
        | "greet.thanks";
      targetPlayerID?: string;
    }
  | { kind: "donate-gold"; amount: number }
  | { kind: "donate-troops"; amount: number }
  | { kind: "none" };

export interface CommunicationPlanContext {
  aidRequest: Parameters<typeof chooseAidRequest>[0];
  donation: DonationContext;
  coordination: CoordinationContext;
  ownTroops: number;
  ownMaxTroops: number;
  ownGold: number;
  allyPlayerID?: string;
  sharedEnemyPlayerID?: string;
  receivedMeaningfulAid: boolean;
  ticksSinceLastThanks: number;
}

const THANKS_COOLDOWN_TICKS = 180;
const MINIMUM_ALLY_RESERVE_FOR_TROOP_REQUEST = 0.6;

void preloadRustAllianceAi();

function requestAction(
  request: AidRequestKind,
  allyPlayerID?: string,
  sharedEnemyPlayerID?: string,
): CommunicationAction {
  switch (request) {
    case "gold":
      return {
        kind: "quick-chat",
        key: "help.gold",
        targetPlayerID: allyPlayerID,
      };
    case "troops":
      return {
        kind: "quick-chat",
        key: "help.troops",
        targetPlayerID: allyPlayerID,
      };
    case "defense":
      return {
        kind: "quick-chat",
        key: "help.help_defend",
        targetPlayerID: sharedEnemyPlayerID,
      };
    default:
      return { kind: "none" };
  }
}

/**
 * Chooses one diplomacy action per decision cycle. Urgent aid requests outrank
 * coordination, donations, and acknowledgements so communication remains useful
 * rather than merely sociable.
 */
export function planCommunication(
  context: CommunicationPlanContext,
): CommunicationAction {
  const rust = planCommunicationRust(context);
  if (rust !== null) return rust;

  const requestedAid = chooseAidRequest(context.aidRequest);
  const request =
    requestedAid === "troops" &&
    context.donation.allyReserveRatio < MINIMUM_ALLY_RESERVE_FOR_TROOP_REQUEST
      ? null
      : requestedAid;
  if (request !== null) {
    return requestAction(
      request,
      context.allyPlayerID,
      context.sharedEnemyPlayerID,
    );
  }

  if (
    context.sharedEnemyPlayerID !== undefined &&
    shouldCoordinateAttack(context.coordination)
  ) {
    return {
      kind: "quick-chat",
      key: "attack.focus",
      targetPlayerID: context.sharedEnemyPlayerID,
    };
  }

  if (shouldDonateTroops(context.donation)) {
    const reserveFloorTroops =
      context.ownMaxTroops * Math.max(0, context.donation.reserveFloor);
    const surplus = Math.max(0, context.ownTroops - reserveFloorTroops);
    const amount = Math.floor(
      Math.min(context.ownTroops * 0.18, surplus * 0.5),
    );
    if (amount > 0) return { kind: "donate-troops", amount };
  }

  if (shouldDonateGold(context.donation)) {
    const surplusGold = Math.max(
      0,
      context.ownGold - context.donation.emergencyGoldFloor,
    );
    const amount = Math.floor(
      Math.min(context.ownGold * 0.2, surplusGold * 0.35),
    );
    if (amount > 0) return { kind: "donate-gold", amount };
  }

  if (
    context.receivedMeaningfulAid &&
    context.ticksSinceLastThanks >= THANKS_COOLDOWN_TICKS
  ) {
    return {
      kind: "quick-chat",
      key: "greet.thanks",
      targetPlayerID: context.allyPlayerID,
    };
  }

  return { kind: "none" };
}
