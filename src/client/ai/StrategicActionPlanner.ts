import type { OpponentChoice } from "./OpponentForecastPolicy";
import {
  modelOpponentRust,
  planStrategicActionRust,
  preloadRustAi,
} from "../rust/OpenFrontWasmAi";

export type StrategicAction =
  | "defend"
  | "strike"
  | "naval"
  | "expand"
  | "attack"
  | "infrastructure";

export type OpponentModel = {
  id: string;
  troopRatio: number;
  territoryRatio: number;
  territoryGrowthRate: number;
  troopGrowthRate: number;
  growthPressure: number;
  militaryPressure: number;
  siloCount: number;
  navalPressure: number;
  predictedChoice?: OpponentChoice;
  forecastThreat?: number;
};

export type StrategicPlan = {
  action: StrategicAction;
  score: number;
  scores: Record<StrategicAction, number>;
  opponent?: OpponentModel;
  reason: string;
};

void preloadRustAi();

export function modelOpponent({
  id,
  troops,
  maxTroops,
  tiles,
  ownTiles,
  incomingAttacks,
  outgoingAttacks,
  silos,
  warships,
  previousTiles = tiles,
  previousTroops = troops,
  elapsedTicks = 1,
  predictedChoice,
  forecastThreat = 0,
}: {
  id: string;
  troops: number;
  maxTroops: number;
  tiles: number;
  ownTiles: number;
  incomingAttacks: number;
  outgoingAttacks: number;
  silos: number;
  warships: number;
  previousTiles?: number;
  previousTroops?: number;
  elapsedTicks?: number;
  predictedChoice?: OpponentChoice;
  forecastThreat?: number;
}): OpponentModel {
  const rust = modelOpponentRust({
    troops,
    maxTroops,
    tiles,
    ownTiles,
    incomingAttacks,
    outgoingAttacks,
    silos,
    warships,
    previousTiles,
    previousTroops,
    elapsedTicks,
    predictedChoice,
    forecastThreat,
  });
  if (rust !== null) {
    return {
      id,
      ...rust,
      predictedChoice,
      forecastThreat,
    };
  }

  const troopRatio = troops / Math.max(1, maxTroops);
  const territoryRatio = tiles / Math.max(1, ownTiles);
  const ticks = Math.max(1, elapsedTicks);
  const territoryGrowthRate = Math.max(0, tiles - previousTiles) / ticks;
  const troopGrowthRate = Math.max(0, troops - previousTroops) / ticks;
  return {
    id,
    troopRatio,
    territoryRatio,
    territoryGrowthRate,
    troopGrowthRate,
    growthPressure: Math.min(
      2,
      territoryRatio * 0.7 +
        territoryGrowthRate * 0.08 +
        (troopGrowthRate / Math.max(1, maxTroops)) * 20 +
        outgoingAttacks * 0.12 +
        (predictedChoice === "expand" || predictedChoice === "economy"
          ? Math.min(0.65, forecastThreat * 0.25 + 0.15)
          : 0),
    ),
    militaryPressure: Math.min(
      2,
      troopRatio * 0.8 +
        incomingAttacks * 0.15 +
        outgoingAttacks * 0.2 +
        (predictedChoice === "attack" ? 0.3 : 0) +
        Math.min(0.7, forecastThreat * 0.2),
    ),
    siloCount: silos,
    navalPressure: Math.min(2, warships * 0.15),
    predictedChoice,
    forecastThreat,
  };
}

export function planStrategicAction({
  reserveRatio,
  incomingFronts,
  incomingTroops,
  maxTroops,
  hasNeutralLand,
  hostileBorders,
  activeNationWars,
  navalThreats,
  tradeTargets,
  navalPressureRatio,
  tradeOpportunityRatio,
  siloTargets,
  readyStrategicSlots = 0,
  affordableStrategicWeapons = 0,
  actionableStrikeTargets = siloTargets,
  opponents,
}: {
  reserveRatio: number;
  incomingFronts: number;
  incomingTroops: number;
  maxTroops: number;
  hasNeutralLand: boolean;
  hostileBorders: number;
  activeNationWars: number;
  navalThreats: number;
  tradeTargets: number;
  navalPressureRatio?: number;
  tradeOpportunityRatio?: number;
  siloTargets: number;
  readyStrategicSlots?: number;
  affordableStrategicWeapons?: number;
  actionableStrikeTargets?: number;
  opponents: readonly OpponentModel[];
}): StrategicPlan {
  const rust = planStrategicActionRust({
    reserveRatio,
    incomingFronts,
    incomingTroops,
    maxTroops,
    hasNeutralLand,
    hostileBorders,
    activeNationWars,
    navalThreats,
    tradeTargets,
    navalPressureRatio,
    tradeOpportunityRatio,
    readyStrategicSlots,
    affordableStrategicWeapons,
    actionableStrikeTargets,
    opponents,
  });
  if (rust !== null) {
    const strongestOpponent =
      rust.strongestOpponentIndex === undefined
        ? undefined
        : opponents[rust.strongestOpponentIndex];
    return {
      action: rust.action,
      score: rust.score,
      scores: rust.scores,
      opponent: strongestOpponent,
      reason: rust.criticalDefense
        ? `defend is mandatory under ${Math.round(rust.incomingTroopRatio * 100)}% incoming pressure with a ${Math.round(reserveRatio * 100)}% reserve`
        : `${rust.action} leads at ${Math.round(rust.score)}; reserve ${Math.round(reserveRatio * 100)}%, ${incomingFronts} incoming fronts, ${hostileBorders} hostile borders`,
    };
  }

  const incomingTroopRatio = incomingTroops / Math.max(1, maxTroops);
  const strongestOpponent = opponents
    .slice()
    .sort(
      (a, b) =>
        b.militaryPressure +
        b.growthPressure -
        (a.militaryPressure + a.growthPressure),
    )[0];
  const scores: Record<StrategicAction, number> = {
    defend:
      incomingFronts * 40 +
      incomingTroopRatio * 70 +
      (reserveRatio < 0.4 ? 35 : 0),
    strike:
      readyStrategicSlots > 0 &&
      affordableStrategicWeapons > 0 &&
      actionableStrikeTargets > 0
        ? // Global observation can include hundreds of remote nations. Only
          // launchable local opportunities may compete with growth and defense.
          Math.min(3, Math.max(0, actionableStrikeTargets)) * 24 +
          (strongestOpponent?.growthPressure ?? 0) * 18 +
          Math.min(3, strongestOpponent?.siloCount ?? 0) * 18
        : 0,
    naval:
      navalPressureRatio === undefined
        ? navalThreats * 28 + tradeTargets * 8
        : Math.max(0, Math.min(1, navalPressureRatio)) * 52 +
          Math.max(0, Math.min(1, tradeOpportunityRatio ?? 0)) * 20,
    expand: hasNeutralLand ? 24 + (reserveRatio > 0.5 ? 22 : 0) : 0,
    attack:
      hostileBorders * 12 +
      (reserveRatio > 0.55 ? 20 : 0) -
      activeNationWars * 18,
    infrastructure:
      (reserveRatio > 0.6 ? 18 : 4) + (hostileBorders > 0 ? 12 : 0),
  };
  const criticalDefense =
    incomingFronts > 0 && (reserveRatio < 0.4 || incomingTroopRatio >= 0.35);
  const action = criticalDefense
    ? "defend"
    : (Object.keys(scores) as StrategicAction[]).sort(
        (a, b) => scores[b] - scores[a],
      )[0];
  return {
    action,
    score: scores[action],
    scores,
    opponent: strongestOpponent,
    reason: criticalDefense
      ? `defend is mandatory under ${Math.round(incomingTroopRatio * 100)}% incoming pressure with a ${Math.round(reserveRatio * 100)}% reserve`
      : `${action} leads at ${Math.round(scores[action])}; reserve ${Math.round(reserveRatio * 100)}%, ${incomingFronts} incoming fronts, ${hostileBorders} hostile borders`,
  };
}
