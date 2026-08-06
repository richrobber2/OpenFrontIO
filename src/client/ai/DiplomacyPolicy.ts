export type AidRequestKind = "gold" | "troops" | "defense" | null;

export interface AidRequestContext {
  reserveRatio: number;
  reserveFloor: number;
  incomingTroopRatio: number;
  gold: number;
  plannedBuildCost: number | null;
  activeNationWars: number;
  hasTrustedAlly: boolean;
  ticksSinceLastRequest: number;
}

export interface DonationContext {
  reserveRatio: number;
  reserveFloor: number;
  gold: number;
  emergencyGoldFloor: number;
  activeNationWars: number;
  allyIncomingTroopRatio: number;
  allyReserveRatio: number;
}

export interface CoordinationContext {
  ownReserveRatio: number;
  allyReserveRatio: number;
  sharedEnemy: boolean;
  enemyActiveWars: number;
  ownActiveNationWars: number;
  ticksSinceLastMessage: number;
}

export const DIPLOMACY_MESSAGE_COOLDOWN_TICKS = 240;

export function chooseAidRequest(context: AidRequestContext): AidRequestKind {
  if (!context.hasTrustedAlly) return null;
  if (context.ticksSinceLastRequest < DIPLOMACY_MESSAGE_COOLDOWN_TICKS) {
    return null;
  }

  if (
    context.incomingTroopRatio >= 0.4 ||
    context.reserveRatio < Math.max(0.25, context.reserveFloor - 0.12)
  ) {
    return "defense";
  }

  if (
    context.reserveRatio < context.reserveFloor ||
    (context.activeNationWars > 0 && context.reserveRatio < 0.5)
  ) {
    return "troops";
  }

  if (
    context.plannedBuildCost !== null &&
    context.gold < context.plannedBuildCost &&
    context.gold >= 0
  ) {
    return "gold";
  }

  return null;
}

export function shouldDonateTroops(context: DonationContext): boolean {
  return (
    context.activeNationWars === 0 &&
    context.reserveRatio >= Math.max(0.75, context.reserveFloor + 0.2) &&
    context.allyIncomingTroopRatio >= 0.35 &&
    context.allyReserveRatio < 0.45
  );
}

export function shouldDonateGold(context: DonationContext): boolean {
  return (
    context.gold > context.emergencyGoldFloor * 1.5 &&
    context.allyIncomingTroopRatio >= 0.25 &&
    context.allyReserveRatio < 0.5
  );
}

export function shouldCoordinateAttack(
  context: CoordinationContext,
): boolean {
  return (
    context.sharedEnemy &&
    context.enemyActiveWars > 0 &&
    context.ownActiveNationWars === 0 &&
    context.ownReserveRatio >= 0.65 &&
    context.allyReserveRatio >= 0.55 &&
    context.ticksSinceLastMessage >= DIPLOMACY_MESSAGE_COOLDOWN_TICKS
  );
}
