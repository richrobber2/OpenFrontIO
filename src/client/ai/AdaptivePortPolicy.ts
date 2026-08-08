import {
  planAdaptivePortActionsRust,
  preloadRustEconomyAi,
  scoreAdaptiveTradePortOptionRust,
} from "../rust/OpenFrontWasmEconomyAi";

void preloadRustEconomyAi();

export type AdaptivePortAction =
  | "hold"
  | "connect"
  | "defend"
  | "repair"
  | "trade";

export type AdaptivePortScores = Record<AdaptivePortAction, number>;

export interface AdaptivePortContext {
  reserveRatio: number;
  incomingPressureRatio: number;
  activeFrontRatio: number;
  gold: number;
  spendableGold: number;
  portCost: number;
  ports: number;
  connectedPorts: number;
  tradePartners: number;
  embargoedPartners: number;
  ownWarships: number;
  desiredWarships: number;
  hostileWarships: number;
  hostileTransports: number;
  tradeTargets: number;
  damagedWarships: number;
  dockCapacity: number;
  transportLossRate: number;
  railProductivityRatio: number;
  navalBias: number;
  economicTradeCoverageTargetRatio?: number;
}

export interface AdaptivePortPlan {
  action: AdaptivePortAction;
  urgency: number;
  scores: AdaptivePortScores;
  connectedPortRatio: number;
  fleetCoverageRatio: number;
  repairLoadRatio: number;
  navalThreatRatio: number;
  tradeCoverageRatio: number;
  budgetCoverageRatio: number;
  targetPartnerCoverageRatio: number;
  candidateSampleRatio: number;
  targetCoverageRatio: number;
  minimumSiteQuality: number;
  minimumBudgetCoverage: number;
  requiredReturnRatio: number;
  maximumPaybackTicks: number;
  repairHealthThreshold: number;
  stackingLoadThreshold: number;
  requireFactoryConnection: boolean;
  constructionPressure: number;
  reason: string;
}

export interface AdaptiveTradePortOption {
  id: string;
  expectedGold: number;
  buildCost: number;
  routeDistance: number;
  closestFriendlyPortDistance: number;
  factoryConnected: boolean;
  survivalRatio?: number;
  spawnIntervalTicks?: number;
  reachablePartners?: number;
  partnerConcentration?: number;
}

export interface RankedTradePortOption extends AdaptiveTradePortOption {
  score: number;
  returnRatio: number;
  distanceEfficiency: number;
  spacingQuality: number;
  expectedGoldPerTick: number;
  paybackTicks: number;
  diversityQuality: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const ratio = (part: number, whole: number, fallback = 0): number =>
  whole <= 0 ? fallback : Math.max(0, part) / Math.max(0.000_001, whole);

const normalize = (value: number, minimum: number, maximum: number): number =>
  maximum <= minimum ? 1 : clamp((value - minimum) / (maximum - minimum), 0, 1);

/**
 * Converts raw match state into ratios before choosing a port action. Counts
 * still enter the policy, but no action is tied to a particular map size,
 * treasury amount, fleet size, or number of nations.
 */
export function planAdaptivePortActions(
  context: AdaptivePortContext,
): AdaptivePortPlan {
  const rust = planAdaptivePortActionsRust(context);
  if (rust !== null) {
    const transportSurvivalRatio = 1 - clamp(context.transportLossRate, 0, 1);
    const reasonByAction: Record<AdaptivePortAction, string> = {
      hold: `hold port spending at ${Math.round(rust.budgetCoverageRatio * 100)}% of one build cost above reserve`,
      connect: `close the ${Math.round((1 - rust.connectedPortRatio) * 100)}% factory-connection gap before adding more shoreline`,
      defend: `cover ${Math.round(rust.navalThreatRatio * 100)}% local naval pressure with ${Math.round(rust.fleetCoverageRatio * 100)}% of the desired fleet`,
      repair: `raise dock throughput under a ${Math.round(rust.repairLoadRatio * 100)}% damaged-fleet load`,
      trade: `expand beyond ${Math.round(rust.tradeCoverageRatio * 100)}% of adaptive partner coverage at ${Math.round(transportSurvivalRatio * 100)}% transport survival`,
    };
    return { ...rust, reason: reasonByAction[rust.action] };
  }

  const reserveHealth = clamp((context.reserveRatio - 0.3) / 0.7, 0, 1);
  const frontPressure = clamp(
    Math.max(context.incomingPressureRatio, context.activeFrontRatio),
    0,
    1,
  );
  const budgetCoverageRatio = ratio(context.spendableGold, context.portCost);
  const budgetReadiness = clamp(budgetCoverageRatio, 0, 1);
  const treasuryCoverageRatio = ratio(context.gold, context.portCost);
  const treasuryDepth = clamp(treasuryCoverageRatio / 3, 0, 1);
  const connectedPortRatio =
    context.ports <= 0
      ? 1
      : clamp(ratio(context.connectedPorts, context.ports), 0, 1);
  const connectionGap = context.ports <= 0 ? 0 : 1 - connectedPortRatio;
  const fleetCoverageRatio =
    context.desiredWarships <= 0
      ? 1
      : clamp(ratio(context.ownWarships, context.desiredWarships), 0, 1);
  const fleetGap = 1 - fleetCoverageRatio;
  const weightedHostiles =
    Math.max(0, context.hostileWarships) +
    Math.max(0, context.hostileTransports) * 0.75;
  const navalThreatRatio = clamp(
    ratio(
      weightedHostiles,
      weightedHostiles + Math.max(0, context.ownWarships) + 1,
    ),
    0,
    1,
  );
  const repairLoadRatio = ratio(
    context.damagedWarships,
    Math.max(1, context.dockCapacity),
  );
  const repairPressure = clamp((repairLoadRatio - 0.5) / 1.5, 0, 1);
  const transportSurvivalRatio = 1 - clamp(context.transportLossRate, 0, 1);
  const relationshipCount =
    Math.max(0, context.tradePartners) + Math.max(0, context.embargoedPartners);
  const accessibleTradeRatio =
    relationshipCount <= 0
      ? 0
      : clamp(ratio(context.tradePartners, relationshipCount), 0, 1);
  const normalizedNavalBias = clamp(context.navalBias / 2, 0, 1);
  const adaptiveTradeCoverageTarget =
    0.04 +
    budgetReadiness * 0.08 +
    normalizedNavalBias * 0.06 +
    transportSurvivalRatio * 0.04;
  const targetPartnerCoverageRatio = clamp(
    context.economicTradeCoverageTargetRatio === undefined
      ? adaptiveTradeCoverageTarget
      : (adaptiveTradeCoverageTarget +
          context.economicTradeCoverageTargetRatio) /
          2,
    0.04,
    0.22,
  );
  const desiredTradeCoverage = Math.max(
    1,
    context.tradePartners * targetPartnerCoverageRatio,
  );
  const tradeCoverageRatio =
    context.tradePartners <= 0
      ? 1
      : clamp(ratio(context.connectedPorts, desiredTradeCoverage), 0, 1);
  const tradeTargetPressure = clamp(
    ratio(context.tradeTargets, context.tradeTargets + context.ownWarships + 1),
    0,
    1,
  );
  const tradeDemand =
    accessibleTradeRatio * (1 - tradeCoverageRatio) * transportSurvivalRatio;
  const railProductivity = clamp(context.railProductivityRatio, 0, 1);

  const scores: AdaptivePortScores = {
    hold:
      (1 - budgetReadiness) * 0.35 +
      (1 - reserveHealth) * 0.3 +
      frontPressure * 0.25 +
      (1 -
        Math.max(
          connectionGap,
          fleetGap,
          repairPressure,
          tradeDemand,
          navalThreatRatio,
        )) *
        0.1,
    connect:
      connectionGap *
      (0.55 +
        railProductivity * 0.15 +
        budgetReadiness * 0.15 +
        reserveHealth * 0.1 +
        (1 - frontPressure) * 0.05),
    defend:
      navalThreatRatio * 0.4 +
      fleetGap * 0.25 +
      Math.max(navalThreatRatio, fleetGap) *
        (budgetReadiness * 0.15 +
          reserveHealth * 0.1 +
          transportSurvivalRatio * 0.1),
    repair:
      repairPressure *
      (0.5 +
        navalThreatRatio * 0.2 +
        budgetReadiness * 0.15 +
        reserveHealth * 0.1 +
        railProductivity * 0.05),
    trade:
      tradeDemand * 0.35 +
      tradeTargetPressure * 0.15 +
      Math.max(tradeDemand, tradeTargetPressure) *
        (railProductivity * 0.15 +
          transportSurvivalRatio * 0.1 +
          budgetReadiness * 0.15 +
          normalizedNavalBias * 0.1),
  };
  const rankedAction = (Object.keys(scores) as AdaptivePortAction[]).sort(
    (a, b) => scores[b] - scores[a],
  )[0];
  const action =
    connectionGap > 0 && scores.connect > scores.hold
      ? "connect"
      : rankedAction;
  const urgency = clamp(
    scores[action] * (1 - scores.hold * 0.35) +
      (action === "defend" ? navalThreatRatio * 0.2 : 0),
    0,
    1,
  );
  const candidateSampleRatio = clamp(0.12 + urgency * 0.35, 0.12, 0.47);
  const targetCoverageRatio = clamp(0.15 + urgency * 0.55, 0.15, 0.7);
  const minimumSiteQuality = clamp(0.62 - urgency * 0.22, 0.4, 0.62);
  const minimumBudgetCoverage = clamp(
    1.5 - urgency * 0.5 + frontPressure * 0.15,
    1,
    1.65,
  );
  const treasuryAdjustedBudgetCoverage = clamp(
    minimumBudgetCoverage - treasuryDepth * 0.08,
    1,
    1.65,
  );
  const requiredReturnRatio = clamp(
    0.28 +
      frontPressure * 0.12 +
      (1 - transportSurvivalRatio) * 0.12 -
      budgetReadiness * 0.06,
    0.18,
    0.52,
  );
  const maximumPaybackTicks = clamp(
    3_600 +
      treasuryDepth * 1_800 -
      frontPressure * 1_500 -
      (1 - transportSurvivalRatio) * 1_200,
    1_200,
    5_400,
  );
  const repairHealthThreshold = clamp(0.7 + navalThreatRatio * 0.22, 0.7, 0.92);
  const stackingLoadThreshold = clamp(1.35 - urgency * 0.25, 1.1, 1.35);
  const requireFactoryConnection =
    action !== "defend" || navalThreatRatio < 0.7;

  const reasonByAction: Record<AdaptivePortAction, string> = {
    hold: `hold port spending at ${Math.round(budgetCoverageRatio * 100)}% of one build cost above reserve`,
    connect: `close the ${Math.round(connectionGap * 100)}% factory-connection gap before adding more shoreline`,
    defend: `cover ${Math.round(navalThreatRatio * 100)}% local naval pressure with ${Math.round(fleetCoverageRatio * 100)}% of the desired fleet`,
    repair: `raise dock throughput under a ${Math.round(repairLoadRatio * 100)}% damaged-fleet load`,
    trade: `expand beyond ${Math.round(tradeCoverageRatio * 100)}% of adaptive partner coverage at ${Math.round(transportSurvivalRatio * 100)}% transport survival`,
  };

  return {
    action,
    urgency,
    scores,
    connectedPortRatio,
    fleetCoverageRatio,
    repairLoadRatio,
    navalThreatRatio,
    tradeCoverageRatio,
    budgetCoverageRatio,
    targetPartnerCoverageRatio,
    candidateSampleRatio,
    targetCoverageRatio,
    minimumSiteQuality,
    minimumBudgetCoverage: treasuryAdjustedBudgetCoverage,
    requiredReturnRatio,
    maximumPaybackTicks,
    repairHealthThreshold,
    stackingLoadThreshold,
    requireFactoryConnection,
    constructionPressure: urgency,
    reason: reasonByAction[action],
  };
}

/**
 * Ranks trade sites by percentage return, relative travel exposure, spacing,
 * and factory integration. It intentionally has no absolute route-distance or
 * fixed-arrival-payback cutoff.
 */
export function rankAdaptiveTradePortOptions(
  plan: Pick<
    AdaptivePortPlan,
    | "minimumSiteQuality"
    | "requiredReturnRatio"
    | "maximumPaybackTicks"
    | "requireFactoryConnection"
  >,
  options: AdaptiveTradePortOption[],
): RankedTradePortOption[] {
  if (options.length === 0) return [];
  const routeDistances = options.map((option) =>
    Math.max(0, option.routeDistance),
  );
  const spacingDistances = options.map((option) =>
    Math.max(0, option.closestFriendlyPortDistance),
  );
  const minimumRoute = Math.min(...routeDistances);
  const maximumRoute = Math.max(...routeDistances);
  const minimumSpacing = Math.min(...spacingDistances);
  const maximumSpacing = Math.max(...spacingDistances);
  const goldRates = options.map((option) => {
    const survival = clamp(option.survivalRatio ?? 1, 0, 1);
    return (
      (Math.max(0, option.expectedGold) * survival) /
      Math.max(1, option.routeDistance + (option.spawnIntervalTicks ?? 100))
    );
  });
  const minimumGoldRate = Math.min(...goldRates);
  const maximumGoldRate = Math.max(...goldRates);
  const normalization = {
    minimumRoute,
    maximumRoute,
    minimumSpacing,
    maximumSpacing,
    minimumGoldRate,
    maximumGoldRate,
  };
  const rustScores = options.map((option) =>
    scoreAdaptiveTradePortOptionRust(
      plan,
      {
        ...option,
        survivalRatio: option.survivalRatio ?? 1,
        spawnIntervalTicks: option.spawnIntervalTicks ?? 100,
        reachablePartners: option.reachablePartners ?? 1,
        partnerConcentration: option.partnerConcentration ?? 1,
      },
      normalization,
    ),
  );
  if (rustScores.every((score) => score !== null)) {
    return options
      .map((option, index) => ({ ...option, ...rustScores[index]! }))
      .filter((option) => option.eligible)
      .map(({ eligible: _eligible, ...option }) => option)
      .sort((a, b) => b.score - a.score);
  }

  return options
    .filter(
      (option) => !plan.requireFactoryConnection || option.factoryConnected,
    )
    .map((option) => {
      const returnRatio = ratio(option.expectedGold, option.buildCost);
      const survival = clamp(option.survivalRatio ?? 1, 0, 1);
      const expectedGoldPerTick =
        (Math.max(0, option.expectedGold) * survival) /
        Math.max(1, option.routeDistance + (option.spawnIntervalTicks ?? 100));
      const paybackTicks = ratio(
        option.buildCost,
        expectedGoldPerTick,
        Infinity,
      );
      const returnQuality = clamp(
        returnRatio / Math.max(0.000_001, plan.requiredReturnRatio * 2),
        0,
        1,
      );
      const distanceEfficiency =
        1 - normalize(option.routeDistance, minimumRoute, maximumRoute);
      const spacingQuality = normalize(
        option.closestFriendlyPortDistance,
        minimumSpacing,
        maximumSpacing,
      );
      const diversityQuality = clamp(
        clamp((option.reachablePartners ?? 1) / 4, 0, 1) * 0.6 +
          (1 - clamp(option.partnerConcentration ?? 1, 0, 1)) * 0.4,
        0,
        1,
      );
      const throughputQuality = normalize(
        expectedGoldPerTick,
        minimumGoldRate,
        maximumGoldRate,
      );
      const paybackQuality = clamp(
        1 - paybackTicks / Math.max(1, plan.maximumPaybackTicks),
        0,
        1,
      );
      const score =
        returnQuality * 0.22 +
        Number(option.factoryConnected) * 0.14 +
        throughputQuality * 0.25 +
        paybackQuality * 0.2 +
        diversityQuality * 0.1 +
        spacingQuality * 0.04 +
        distanceEfficiency * 0.05;
      return {
        ...option,
        score,
        returnRatio,
        distanceEfficiency,
        spacingQuality,
        expectedGoldPerTick,
        paybackTicks,
        diversityQuality,
      };
    })
    .filter(
      (option) =>
        option.returnRatio >= plan.requiredReturnRatio &&
        option.paybackTicks <= plan.maximumPaybackTicks &&
        option.score >= plan.minimumSiteQuality,
    )
    .sort((a, b) => b.score - a.score);
}
