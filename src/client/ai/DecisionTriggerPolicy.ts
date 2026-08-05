export interface IdleGrowthTriggerContext {
  tick: number;
  reserveRatio: number;
  outgoingFronts: number;
  hasTribeBorder: boolean;
}

export type AdaptivePlanningMode = "reactive" | "scheduled" | "reuse";

export type AdaptivePlanningObservation = {
  incomingFronts: number;
  outgoingFronts: number;
  tribesAlive: number;
  reserveRatio: number;
  tiles: number;
  strategicStructures: number;
};

export type AdaptivePlanningDecision = {
  run: boolean;
  mode: AdaptivePlanningMode;
  intervalTicks: number;
  forecastHorizonTicks: number;
  refreshOpponentForecasts: boolean;
  reason: string;
};

export function estimateTicksUntilReserve(context: {
  troops: number;
  maxTroops: number;
  troopIncreasePerTick: number;
  targetRatio: number;
  maxHorizonTicks?: number;
}): number {
  const maxTroops = Math.max(1, context.maxTroops);
  const targetTroops =
    maxTroops * Math.max(0, Math.min(1, context.targetRatio));
  const missingTroops = Math.max(0, targetTroops - Math.max(0, context.troops));
  if (missingTroops === 0) return 0;
  const maxHorizonTicks = Math.max(
    1,
    Math.floor(context.maxHorizonTicks ?? 120),
  );
  if (context.troopIncreasePerTick <= 0) return maxHorizonTicks;
  return Math.min(
    maxHorizonTicks,
    Math.max(1, Math.ceil(missingTroops / context.troopIncreasePerTick)),
  );
}

/**
 * Full strategic scans are valuable after a material state change, but they
 * are wasteful while the same front is active or the reserve is predictably
 * regenerating. Per-tick safety monitors remain active while this policy
 * reuses the last plan.
 */
export function planAdaptivePlanningCadence(context: {
  tick: number;
  lastPlanningTick: number;
  nextPlanningTick: number;
  current: AdaptivePlanningObservation;
  previous?: AdaptivePlanningObservation;
  ticksUntilUsefulReserve: number;
}): AdaptivePlanningDecision {
  const tick = Math.max(0, Math.floor(context.tick));
  const nextPlanningTick = Math.max(tick, Math.floor(context.nextPlanningTick));
  const ticksUntilUsefulReserve = Math.max(
    0,
    Math.floor(context.ticksUntilUsefulReserve),
  );
  const forecastHorizonTicks = Math.max(
    8,
    Math.min(120, ticksUntilUsefulReserve || 30),
  );

  if (tick <= context.lastPlanningTick) {
    return {
      run: false,
      mode: "reuse",
      intervalTicks: Math.max(1, nextPlanningTick - tick),
      forecastHorizonTicks,
      refreshOpponentForecasts: false,
      reason: "A full planning pass already ran on this simulation tick.",
    };
  }

  const previous = context.previous;
  if (previous === undefined) {
    return {
      run: true,
      mode: "reactive",
      intervalTicks: 1,
      forecastHorizonTicks,
      refreshOpponentForecasts: true,
      reason: "No reusable strategic observation exists yet.",
    };
  }

  const incomingChanged =
    context.current.incomingFronts !== previous.incomingFronts;
  const outgoingChanged =
    context.current.outgoingFronts !== previous.outgoingFronts;
  const tribeConquered = context.current.tribesAlive < previous.tribesAlive;
  const lostTerritory = context.current.tiles < previous.tiles;
  const reserveShock =
    previous.reserveRatio - context.current.reserveRatio >= 0.04;
  const structuresChanged =
    context.current.strategicStructures !== previous.strategicStructures;

  if (
    incomingChanged ||
    outgoingChanged ||
    tribeConquered ||
    lostTerritory ||
    reserveShock ||
    structuresChanged
  ) {
    const reason = incomingChanged
      ? "The number of incoming fronts changed."
      : outgoingChanged
        ? "The number of outgoing fronts changed."
        : tribeConquered
          ? "A tribe conquest completed, so the next growth target is evaluated immediately."
          : lostTerritory
            ? "Owned territory changed under hostile pressure."
            : reserveShock
              ? "The home reserve fell materially."
              : "Strategic infrastructure changed.";
    return {
      run: true,
      mode: "reactive",
      intervalTicks: 2,
      forecastHorizonTicks: Math.min(30, forecastHorizonTicks),
      refreshOpponentForecasts: true,
      reason,
    };
  }

  if (tick < nextPlanningTick) {
    return {
      run: false,
      mode: "reuse",
      intervalTicks: Math.max(1, nextPlanningTick - tick),
      forecastHorizonTicks,
      refreshOpponentForecasts: false,
      reason: `The prior plan remains useful for ${nextPlanningTick - tick} more tick(s).`,
    };
  }

  if (context.current.incomingFronts > 0) {
    return {
      run: true,
      mode: "reactive",
      intervalTicks: 2,
      forecastHorizonTicks: Math.min(20, forecastHorizonTicks),
      refreshOpponentForecasts: false,
      reason:
        "An unchanged incoming front receives a frequent defensive review while safety monitors remain live.",
    };
  }

  if (context.current.outgoingFronts > 0) {
    return {
      run: true,
      mode: "scheduled",
      intervalTicks: 3,
      forecastHorizonTicks,
      refreshOpponentForecasts: false,
      reason: "An active operation only needs periodic strategic review.",
    };
  }

  if (ticksUntilUsefulReserve > 24) {
    const intervalTicks = Math.max(
      4,
      Math.min(12, Math.ceil(ticksUntilUsefulReserve / 6)),
    );
    return {
      run: true,
      mode: "scheduled",
      intervalTicks,
      forecastHorizonTicks,
      refreshOpponentForecasts: false,
      reason: `The reserve is predicted to need about ${ticksUntilUsefulReserve} ticks before another major action.`,
    };
  }

  const intervalTicks = context.current.reserveRatio < 0.72 ? 4 : 2;
  return {
    run: true,
    mode: "scheduled",
    intervalTicks,
    forecastHorizonTicks,
    refreshOpponentForecasts: false,
    reason:
      intervalTicks === 4
        ? "The reserve is still rebuilding, so the current plan can be reused briefly."
        : "A ready reserve is checked frequently for a new opportunity.",
  };
}

/**
 * A safe reserve with no active front wastes potential regeneration and land
 * scaling. Tribe selection applies its stricter front-aware reserve check, so
 * this trigger only needs to run early enough to give growth first refusal.
 */
export function shouldTriggerIdleGrowth(
  context: IdleGrowthTriggerContext,
): boolean {
  return (
    context.tick > 40 &&
    context.reserveRatio >= 0.66 &&
    context.outgoingFronts === 0 &&
    context.hasTribeBorder
  );
}

/** Construction needs time to appear in unit state before another attempt. */
export function navalConstructionRetryTick(
  currentTick: number,
  structure: "port" | "warship",
  constructionPressure = 0.5,
): number {
  const normalizedPressure = Math.max(0, Math.min(1, constructionPressure));
  const baseTicks = structure === "port" ? 150 : 100;
  const adaptiveRatio = 1.3 - normalizedPressure * 0.6;
  return currentTick + Math.max(1, Math.round(baseTicks * adaptiveRatio));
}

/** Avoid rescanning the same expensive rail candidates without a state change. */
export function factoryOpportunityRetryTick(
  currentTick: number,
  outcome: "built" | "unaffordable" | "saturated",
): number {
  return (
    currentTick +
    (outcome === "built" ? 100 : outcome === "unaffordable" ? 200 : 400)
  );
}

export function shouldTriggerEmergencyCity(context: {
  tick: number;
  nextAttemptTick: number;
  incomingTroops: number;
  maxTroops: number;
  reserveRatio: number;
  currentCities: number;
  desiredCities: number;
}): boolean {
  return (
    context.tick >= context.nextAttemptTick &&
    context.currentCities < context.desiredCities &&
    (context.incomingTroops >= Math.max(1, context.maxTroops) * 0.35 ||
      context.reserveRatio < 0.5)
  );
}

/**
 * Config.attackTilesPerTick scales capture speed from the attack force divided
 * by the defender's currently alive troops. Return that speed as a fraction of
 * the engine's maximum player-vs-player capture rate.
 */
export function relativeLandAttackSpeed(
  attackTroops: number,
  defenderTroops: number,
): number {
  const liveRatio =
    (10 * Math.max(0, attackTroops)) / Math.max(1, defenderTroops);
  return Math.min(0.5, Math.max(0.01, liveRatio)) / 0.5;
}

export function defensiveCounterBudget(context: {
  homeTroops: number;
  maxTroops: number;
  totalIncomingTroops: number;
  selectedIncomingTroops: number;
  activeIncomingFronts?: number;
  reserveFloorRatio?: number;
  targetAttackerToDefenderRatio?: number;
}): {
  counterTroops: number;
  protectedTroops: number;
  remainingIncomingTroops: number;
  projectedAttackerToDefenderRatio: number;
  currentRelativeCaptureSpeed: number;
  projectedRelativeCaptureSpeed: number;
  targetAttackerToDefenderRatio: number;
} {
  const homeTroops = Math.max(0, context.homeTroops);
  const activeIncomingFronts = Math.max(
    1,
    Math.floor(context.activeIncomingFronts ?? 1),
  );
  const reserveFloorRatio =
    context.reserveFloorRatio ??
    Math.min(0.75, 0.4 + (activeIncomingFronts - 1) * 0.1);
  const capacityFloor = Math.max(0, context.maxTroops) * reserveFloorRatio;
  const totalIncomingTroops = Math.max(0, context.totalIncomingTroops);
  const selectedIncomingTroops = Math.max(0, context.selectedIncomingTroops);
  const targetAttackerToDefenderRatio = Math.min(
    0.02,
    Math.max(0.001, context.targetAttackerToDefenderRatio ?? 0.0025),
  );
  const maximumCounter = Math.max(0, homeTroops - capacityFloor);

  // Opposing attacks cancel one another troop-for-troop. Solve for the exact
  // counter that leaves the selected invasion at a tiny ratio of the remaining
  // live home force: (incoming - counter) / (home - counter) = target ratio.
  // This avoids over-cancelling the invasion and accidentally creating a new,
  // low-value counter-invasion. Multi-front numerical inferiority still blocks
  // a launch because removing home troops would accelerate every other front.
  const desiredCounter =
    homeTroops > totalIncomingTroops &&
    selectedIncomingTroops > targetAttackerToDefenderRatio * homeTroops
      ? (selectedIncomingTroops - targetAttackerToDefenderRatio * homeTroops) /
        (1 - targetAttackerToDefenderRatio)
      : 0;
  const counterTroops = Math.min(
    maximumCounter,
    Math.max(0, desiredCounter),
    selectedIncomingTroops * 0.999,
  );
  const protectedTroops = Math.max(0, homeTroops - counterTroops);
  const remainingIncomingTroops = Math.max(
    0,
    selectedIncomingTroops - counterTroops,
  );
  const projectedAttackerToDefenderRatio =
    remainingIncomingTroops / Math.max(1, protectedTroops);
  return {
    counterTroops,
    protectedTroops,
    remainingIncomingTroops,
    projectedAttackerToDefenderRatio,
    currentRelativeCaptureSpeed: relativeLandAttackSpeed(
      selectedIncomingTroops,
      homeTroops,
    ),
    projectedRelativeCaptureSpeed: relativeLandAttackSpeed(
      remainingIncomingTroops,
      protectedTroops,
    ),
    targetAttackerToDefenderRatio,
  };
}

/**
 * Launch normal-sized counters, exact cancellations retained for compatibility,
 * or smaller counters that cut the engine's live-troop capture speed by at
 * least half and leave the invasion at ten percent or less of maximum speed.
 */
export function shouldLaunchDefensiveCounter(context: {
  homeTroops: number;
  selectedIncomingTroops: number;
  counterTroops: number;
  normalMinimumFraction?: number;
  currentRelativeCaptureSpeed?: number;
  projectedRelativeCaptureSpeed?: number;
}): boolean {
  const homeTroops = Math.max(1, context.homeTroops);
  const counterTroops = Math.max(0, context.counterTroops);
  const selectedIncomingTroops = Math.max(0, context.selectedIncomingTroops);
  const normalMinimumFraction = Math.max(
    0,
    context.normalMinimumFraction ?? 0.08,
  );
  const currentRelativeCaptureSpeed = Math.max(
    0,
    context.currentRelativeCaptureSpeed ?? 1,
  );
  const projectedRelativeCaptureSpeed = Math.max(
    0,
    context.projectedRelativeCaptureSpeed ?? 1,
  );
  const usefulEngineSlowdown =
    counterTroops > 0 &&
    projectedRelativeCaptureSpeed <= 0.1 &&
    projectedRelativeCaptureSpeed <= currentRelativeCaptureSpeed * 0.5;

  return (
    counterTroops / homeTroops >= normalMinimumFraction ||
    counterTroops >= selectedIncomingTroops * 1.02 ||
    usefulEngineSlowdown
  );
}

export type RaidRecallDefenseProjection = {
  recall: boolean;
  reserveFloorRatio: number;
  reserveFloorTroops: number;
  projectedCaptureRatio: number;
  projectedHomeTroops: number;
  returningTroops: number;
  projectedTroopsAfterReturn: number;
  thirdPartyPressure: boolean;
};

/**
 * Estimate how much of the home force will be consumed during the engine's
 * raid-return delay. Config.attackLogic removes roughly the same fraction of
 * defender troops as owned land, so the loss rate measured on the current map
 * is portable across seeds without a fitted capture coefficient.
 */
export function evaluateRaidRecallDefense(context: {
  homeTroops: number;
  maxTroops: number;
  raidTroops: number;
  totalIncomingTroops: number;
  thirdPartyIncomingTroops: number;
  ownedTiles: number;
  observedTileLossPerTick: number;
  observedTroopLossPerTick: number;
  returnDelayTicks: number;
  raidReturnSurvivalRatio: number;
  reserveFloorRatio: number;
}): RaidRecallDefenseProjection {
  const homeTroops = Math.max(0, context.homeTroops);
  const maxTroops = Math.max(1, context.maxTroops);
  const totalIncomingTroops = Math.max(0, context.totalIncomingTroops);
  const thirdPartyIncomingTroops = Math.max(
    0,
    context.thirdPartyIncomingTroops,
  );
  const returnDelayTicks = Math.max(1, Math.floor(context.returnDelayTicks));
  const reserveFloorRatio = Math.max(0, Math.min(1, context.reserveFloorRatio));
  const reserveFloorTroops = maxTroops * reserveFloorRatio;
  const observedTileLoss = Math.max(0, context.observedTileLossPerTick);
  const observedTroopLoss = Math.max(0, context.observedTroopLossPerTick);
  const projectedCaptureRatio = Math.min(
    1,
    (observedTileLoss * returnDelayTicks) / Math.max(1, context.ownedTiles),
  );
  // Before enough live loss samples exist, the visible incoming force is the
  // conservative cancellation budget. Once combat is underway, use whichever
  // is worse: that budget or the loss rate actually measured on this seed.
  const projectedHomeTroops = Math.max(
    0,
    homeTroops -
      Math.max(totalIncomingTroops, observedTroopLoss * returnDelayTicks),
  );
  const raidReturnSurvivalRatio = Math.max(
    0,
    Math.min(1, context.raidReturnSurvivalRatio),
  );
  const returningTroops =
    Math.max(0, context.raidTroops) * raidReturnSurvivalRatio;
  const projectedTroopsAfterReturn = projectedHomeTroops + returningTroops;
  const thirdPartyPressure = thirdPartyIncomingTroops > 0;
  const recall =
    totalIncomingTroops > 0 && projectedHomeTroops < reserveFloorTroops;

  return {
    recall,
    reserveFloorRatio,
    reserveFloorTroops,
    projectedCaptureRatio,
    projectedHomeTroops,
    returningTroops,
    projectedTroopsAfterReturn,
    thirdPartyPressure,
  };
}

export function shouldPreFortifyInfrastructure(context: {
  borderingNationThreats: number;
  strategicStructures: number;
  reserveRatio: number;
  reserveFloorRatio: number;
  outgoingFronts: number;
  defensePosts: number;
  cities: number;
}): boolean {
  return (
    context.borderingNationThreats > 0 &&
    context.strategicStructures > 0 &&
    context.outgoingFronts === 0 &&
    context.defensePosts < Math.max(1, context.cities) &&
    context.reserveRatio >= context.reserveFloorRatio
  );
}

/** Keep telemetry useful without rewriting its full history every game tick. */
export function shouldPublishTelemetry(
  tick: number,
  lastPublishedTick: number,
  interval = 25,
): boolean {
  return (
    tick !== lastPublishedTick && tick % Math.max(1, Math.floor(interval)) === 0
  );
}
