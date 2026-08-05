export type ElasticDefenseAction =
  | "hold"
  | "counterattack"
  | "trade_land"
  | "cancel_offensives";

export interface ElasticDefenseContext {
  reserveRatio: number;
  reserveFloor: number;
  incomingTroopRatio: number;
  incomingFronts: number;
  outgoingCommittedRatio: number;
  borderEconomicValue: number;
  interiorDefenseValue: number;
  territoryShare: number;
  recentTileLossRate: number;
  attackerTroopAdvantage: number;
}

export interface ElasticDefenseDecision {
  action: ElasticDefenseAction;
  counterFraction: number;
  reasons: string[];
}

export function chooseElasticDefense(
  context: ElasticDefenseContext,
): ElasticDefenseDecision {
  const reasons: string[] = [];
  const reserveDeficit = context.reserveFloor - context.reserveRatio;
  const lowValueBorder =
    context.borderEconomicValue < Math.max(0.2, context.interiorDefenseValue * 0.45);
  const severePressure =
    context.incomingTroopRatio >= 0.65 ||
    context.attackerTroopAdvantage >= 1.45 ||
    context.incomingFronts >= 3;

  if (
    context.outgoingCommittedRatio >= 0.3 &&
    (reserveDeficit > 0 || context.incomingTroopRatio >= 0.45)
  ) {
    reasons.push("offensive commitments are starving the defense");
    return { action: "cancel_offensives", counterFraction: 0, reasons };
  }

  if (
    severePressure &&
    lowValueBorder &&
    context.territoryShare > 0.08 &&
    context.recentTileLossRate < 0.18
  ) {
    reasons.push("outer land is cheaper than the troops needed to hold it");
    reasons.push("preserve the army for an interior defensive line");
    return { action: "trade_land", counterFraction: 0, reasons };
  }

  if (
    context.reserveRatio >= context.reserveFloor + 0.12 &&
    context.attackerTroopAdvantage < 0.9 &&
    context.incomingFronts === 1
  ) {
    const counterFraction = Math.min(
      0.45,
      Math.max(0.12, context.incomingTroopRatio * 0.65),
    );
    reasons.push("attacker is overextended on a single front");
    return { action: "counterattack", counterFraction, reasons };
  }

  reasons.push("hold the line while rebuilding reserves");
  return { action: "hold", counterFraction: 0, reasons };
}
