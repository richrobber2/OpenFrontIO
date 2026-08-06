import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type VisualAiTelemetrySnapshot = {
  capturedAt: string;
  tick: number;
  decision: string;
  detail: string;
  decisionCycles: number;
  planAction?: string;
  planScore?: number;
  reserveRatio: number;
  troops: number;
  maxTroops: number;
  tiles: number;
  incomingFronts: number;
  incomingTroops: number;
  thirdPartyIncomingTroops?: number;
  outgoingFronts: number;
  activeRaidTarget?: string;
  activeRaidTroops?: number;
  cities?: number;
  stackedCities?: number;
  largestCityStack?: number;
  factories?: number;
  factoryProductiveStops?: number;
  isolatedFactories?: number;
  factoryConnectedPorts?: number;
  unconnectedPorts?: number;
  economicAction?: string;
  economicScore?: number;
  economicGoldReserve?: number;
  economicSpendableGold?: number;
  estimatedIncomePerMinute?: number;
  recurringIncomeWindfallRatio?: number;
  exposedEconomicStructures?: number;
  tradePartners?: number;
  embargoedPartners?: number;
  connectedRailStops?: number;
  railStops?: number;
  defensePosts?: number;
  strategicStructures?: number;
  opponentsAlive: number;
  forecastedOpponents?: number;
  opponentForecastAccuracy?: number;
  highestForecastThreat?: number;
  predictedEnemyChoice?: string;
  predictedEnemyName?: string;
  remnantTargets?: number;
  allianceAction?: string;
  allyReliability?: number;
  trustedAllies?: number;
  coalitionTarget?: string;
  coalitionAvailableHelpers?: number;
  coalitionTreatyBlockedHelpers?: number;
  coalitionOffensiveCostMultiplier?: number;
  coalitionGrowthDonations?: number;
  coalitionGrowthRateGain?: number;
  allyRequestsSent?: number;
  allyRequestsAnswered?: number;
  allyIgnoredRequests?: number;
  strategicCollateralRejections?: number;
  strategicOwnSilos?: number;
  strategicReadySlots?: number;
  strategicCandidateCount?: number;
  strategicLaunches?: number;
  strategicSiloBuilds?: number;
  strategicRouteRejections?: number;
  strategicStatus?: string;
  strategicTarget?: string;
  strategicWeapon?: string;
  strategicScore?: number;
  moduleConsensusAction?: string;
  modulePreferredInvestment?: string;
  shipyardConnectionPriority?: number;
  portAction?: string;
  portActionUrgency?: number;
  portBudgetCoverageRatio?: number;
  portFleetCoverageRatio?: number;
  portRepairLoadRatio?: number;
  portThreatRatio?: number;
  portTradeCoverageRatio?: number;
  landCapacityGain?: number;
  landRegenerationMultiplier?: number;
  predictionCount: number;
  predictionError: number;
  mutationGeneration: number;
  troopDisplayDivisor?: number;
  planningMs: number;
  planningStage?: string;
  planningStageMs?: number;
  planningMode?: "reactive" | "scheduled" | "reuse";
  planningIntervalTicks?: number;
  planningForecastHorizonTicks?: number;
  planningPassesSkipped?: number;
  planningPassesExecuted?: number;
  predictedReadyTick?: number;
  opponentForecastIntervalTicks?: number;
};

export type VisualAiTelemetry = {
  version: 1;
  latest: VisualAiTelemetrySnapshot;
  history: VisualAiTelemetrySnapshot[];
};

const telemetryPath = path.resolve("data", "visual-ai-telemetry.json");
const historyLimit = 256;
let saveQueue = Promise.resolve();

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseVisualAiTelemetry(
  value: unknown,
): VisualAiTelemetrySnapshot {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid AI telemetry");
  const input = value as Record<string, unknown>;
  const requiredNumbers = [
    "tick",
    "decisionCycles",
    "reserveRatio",
    "troops",
    "maxTroops",
    "tiles",
    "incomingFronts",
    "incomingTroops",
    "outgoingFronts",
    "opponentsAlive",
    "predictionCount",
    "predictionError",
    "mutationGeneration",
    "planningMs",
  ];
  if (
    typeof input.decision !== "string" ||
    typeof input.detail !== "string" ||
    requiredNumbers.some((key) => !finite(input[key]))
  ) {
    throw new Error("Invalid AI telemetry");
  }
  const clipped = (value: string, max: number) => value.slice(0, max);
  return {
    capturedAt: new Date().toISOString(),
    tick: Math.max(0, Math.floor(input.tick as number)),
    decision: clipped(input.decision, 120),
    detail: clipped(input.detail, 500),
    decisionCycles: Math.max(0, Math.floor(input.decisionCycles as number)),
    planAction:
      typeof input.planAction === "string"
        ? clipped(input.planAction, 40)
        : undefined,
    planScore: finite(input.planScore) ? input.planScore : undefined,
    reserveRatio: Math.max(0, Math.min(2, input.reserveRatio as number)),
    troops: Math.max(0, input.troops as number),
    maxTroops: Math.max(0, input.maxTroops as number),
    tiles: Math.max(0, Math.floor(input.tiles as number)),
    incomingFronts: Math.max(0, Math.floor(input.incomingFronts as number)),
    incomingTroops: Math.max(0, input.incomingTroops as number),
    thirdPartyIncomingTroops: finite(input.thirdPartyIncomingTroops)
      ? Math.max(0, input.thirdPartyIncomingTroops)
      : undefined,
    outgoingFronts: Math.max(0, Math.floor(input.outgoingFronts as number)),
    activeRaidTarget:
      typeof input.activeRaidTarget === "string"
        ? clipped(input.activeRaidTarget, 80)
        : undefined,
    activeRaidTroops: finite(input.activeRaidTroops)
      ? Math.max(0, input.activeRaidTroops)
      : undefined,
    cities: finite(input.cities)
      ? Math.max(0, Math.floor(input.cities))
      : undefined,
    stackedCities: finite(input.stackedCities)
      ? Math.max(0, Math.floor(input.stackedCities))
      : undefined,
    largestCityStack: finite(input.largestCityStack)
      ? Math.max(0, Math.floor(input.largestCityStack))
      : undefined,
    factories: finite(input.factories)
      ? Math.max(0, Math.floor(input.factories))
      : undefined,
    factoryProductiveStops: finite(input.factoryProductiveStops)
      ? Math.max(0, Math.floor(input.factoryProductiveStops))
      : undefined,
    isolatedFactories: finite(input.isolatedFactories)
      ? Math.max(0, Math.floor(input.isolatedFactories))
      : undefined,
    factoryConnectedPorts: finite(input.factoryConnectedPorts)
      ? Math.max(0, Math.floor(input.factoryConnectedPorts))
      : undefined,
    unconnectedPorts: finite(input.unconnectedPorts)
      ? Math.max(0, Math.floor(input.unconnectedPorts))
      : undefined,
    economicAction:
      typeof input.economicAction === "string"
        ? clipped(input.economicAction, 40)
        : undefined,
    economicScore: finite(input.economicScore)
      ? input.economicScore
      : undefined,
    economicGoldReserve: finite(input.economicGoldReserve)
      ? Math.max(0, input.economicGoldReserve)
      : undefined,
    economicSpendableGold: finite(input.economicSpendableGold)
      ? Math.max(0, input.economicSpendableGold)
      : undefined,
    estimatedIncomePerMinute: finite(input.estimatedIncomePerMinute)
      ? Math.max(0, input.estimatedIncomePerMinute)
      : undefined,
    recurringIncomeWindfallRatio: finite(input.recurringIncomeWindfallRatio)
      ? Math.max(0, Math.min(1, input.recurringIncomeWindfallRatio))
      : undefined,
    exposedEconomicStructures: finite(input.exposedEconomicStructures)
      ? Math.max(0, Math.floor(input.exposedEconomicStructures))
      : undefined,
    tradePartners: finite(input.tradePartners)
      ? Math.max(0, Math.floor(input.tradePartners))
      : undefined,
    embargoedPartners: finite(input.embargoedPartners)
      ? Math.max(0, Math.floor(input.embargoedPartners))
      : undefined,
    connectedRailStops: finite(input.connectedRailStops)
      ? Math.max(0, Math.floor(input.connectedRailStops))
      : undefined,
    railStops: finite(input.railStops)
      ? Math.max(0, Math.floor(input.railStops))
      : undefined,
    defensePosts: finite(input.defensePosts)
      ? Math.max(0, Math.floor(input.defensePosts))
      : undefined,
    strategicStructures: finite(input.strategicStructures)
      ? Math.max(0, Math.floor(input.strategicStructures))
      : undefined,
    opponentsAlive: Math.max(0, Math.floor(input.opponentsAlive as number)),
    forecastedOpponents: finite(input.forecastedOpponents)
      ? Math.max(0, Math.floor(input.forecastedOpponents))
      : undefined,
    opponentForecastAccuracy: finite(input.opponentForecastAccuracy)
      ? Math.max(0, Math.min(1, input.opponentForecastAccuracy))
      : undefined,
    highestForecastThreat: finite(input.highestForecastThreat)
      ? Math.max(0, input.highestForecastThreat)
      : undefined,
    predictedEnemyChoice:
      typeof input.predictedEnemyChoice === "string"
        ? clipped(input.predictedEnemyChoice, 32)
        : undefined,
    predictedEnemyName:
      typeof input.predictedEnemyName === "string"
        ? clipped(input.predictedEnemyName, 80)
        : undefined,
    remnantTargets: finite(input.remnantTargets)
      ? Math.max(0, Math.floor(input.remnantTargets))
      : undefined,
    allianceAction:
      typeof input.allianceAction === "string"
        ? clipped(input.allianceAction, 32)
        : undefined,
    allyReliability: finite(input.allyReliability)
      ? Math.max(0, Math.min(1, input.allyReliability))
      : undefined,
    trustedAllies: finite(input.trustedAllies)
      ? Math.max(0, Math.floor(input.trustedAllies))
      : undefined,
    coalitionTarget:
      typeof input.coalitionTarget === "string"
        ? clipped(input.coalitionTarget, 80)
        : undefined,
    coalitionAvailableHelpers: finite(input.coalitionAvailableHelpers)
      ? Math.max(0, Math.floor(input.coalitionAvailableHelpers))
      : undefined,
    coalitionTreatyBlockedHelpers: finite(input.coalitionTreatyBlockedHelpers)
      ? Math.max(0, Math.floor(input.coalitionTreatyBlockedHelpers))
      : undefined,
    coalitionOffensiveCostMultiplier: finite(
      input.coalitionOffensiveCostMultiplier,
    )
      ? Math.max(0, Math.min(1, input.coalitionOffensiveCostMultiplier))
      : undefined,
    coalitionGrowthDonations: finite(input.coalitionGrowthDonations)
      ? Math.max(0, Math.floor(input.coalitionGrowthDonations))
      : undefined,
    coalitionGrowthRateGain: finite(input.coalitionGrowthRateGain)
      ? Math.max(0, input.coalitionGrowthRateGain)
      : undefined,
    allyRequestsSent: finite(input.allyRequestsSent)
      ? Math.max(0, Math.floor(input.allyRequestsSent))
      : undefined,
    allyRequestsAnswered: finite(input.allyRequestsAnswered)
      ? Math.max(0, Math.floor(input.allyRequestsAnswered))
      : undefined,
    allyIgnoredRequests: finite(input.allyIgnoredRequests)
      ? Math.max(0, Math.floor(input.allyIgnoredRequests))
      : undefined,
    strategicCollateralRejections: finite(input.strategicCollateralRejections)
      ? Math.max(0, Math.floor(input.strategicCollateralRejections))
      : undefined,
    strategicOwnSilos: finite(input.strategicOwnSilos)
      ? Math.max(0, Math.floor(input.strategicOwnSilos))
      : undefined,
    strategicReadySlots: finite(input.strategicReadySlots)
      ? Math.max(0, Math.floor(input.strategicReadySlots))
      : undefined,
    strategicCandidateCount: finite(input.strategicCandidateCount)
      ? Math.max(0, Math.floor(input.strategicCandidateCount))
      : undefined,
    strategicLaunches: finite(input.strategicLaunches)
      ? Math.max(0, Math.floor(input.strategicLaunches))
      : undefined,
    strategicSiloBuilds: finite(input.strategicSiloBuilds)
      ? Math.max(0, Math.floor(input.strategicSiloBuilds))
      : undefined,
    strategicRouteRejections: finite(input.strategicRouteRejections)
      ? Math.max(0, Math.floor(input.strategicRouteRejections))
      : undefined,
    strategicStatus:
      typeof input.strategicStatus === "string"
        ? clipped(input.strategicStatus, 160)
        : undefined,
    strategicTarget:
      typeof input.strategicTarget === "string"
        ? clipped(input.strategicTarget, 80)
        : undefined,
    strategicWeapon:
      typeof input.strategicWeapon === "string"
        ? clipped(input.strategicWeapon, 32)
        : undefined,
    strategicScore: finite(input.strategicScore)
      ? input.strategicScore
      : undefined,
    moduleConsensusAction:
      typeof input.moduleConsensusAction === "string"
        ? clipped(input.moduleConsensusAction, 24)
        : undefined,
    modulePreferredInvestment:
      typeof input.modulePreferredInvestment === "string"
        ? clipped(input.modulePreferredInvestment, 48)
        : undefined,
    shipyardConnectionPriority: finite(input.shipyardConnectionPriority)
      ? Math.max(0, Math.min(1, input.shipyardConnectionPriority))
      : undefined,
    portAction:
      typeof input.portAction === "string"
        ? clipped(input.portAction, 24)
        : undefined,
    portActionUrgency: finite(input.portActionUrgency)
      ? Math.max(0, Math.min(1, input.portActionUrgency))
      : undefined,
    portBudgetCoverageRatio: finite(input.portBudgetCoverageRatio)
      ? Math.max(0, input.portBudgetCoverageRatio)
      : undefined,
    portFleetCoverageRatio: finite(input.portFleetCoverageRatio)
      ? Math.max(0, input.portFleetCoverageRatio)
      : undefined,
    portRepairLoadRatio: finite(input.portRepairLoadRatio)
      ? Math.max(0, input.portRepairLoadRatio)
      : undefined,
    portThreatRatio: finite(input.portThreatRatio)
      ? Math.max(0, Math.min(1, input.portThreatRatio))
      : undefined,
    portTradeCoverageRatio: finite(input.portTradeCoverageRatio)
      ? Math.max(0, Math.min(1, input.portTradeCoverageRatio))
      : undefined,
    landCapacityGain: finite(input.landCapacityGain)
      ? Math.max(0, input.landCapacityGain)
      : undefined,
    landRegenerationMultiplier: finite(input.landRegenerationMultiplier)
      ? Math.max(0, input.landRegenerationMultiplier)
      : undefined,
    predictionCount: Math.max(0, Math.floor(input.predictionCount as number)),
    predictionError: input.predictionError as number,
    mutationGeneration: Math.max(
      0,
      Math.floor(input.mutationGeneration as number),
    ),
    troopDisplayDivisor: finite(input.troopDisplayDivisor)
      ? Math.max(1, Math.floor(input.troopDisplayDivisor))
      : undefined,
    planningMs: Math.max(0, input.planningMs as number),
    planningStage:
      typeof input.planningStage === "string"
        ? clipped(input.planningStage, 60)
        : undefined,
    planningStageMs: finite(input.planningStageMs)
      ? Math.max(0, input.planningStageMs)
      : undefined,
    planningMode:
      input.planningMode === "reactive" ||
      input.planningMode === "scheduled" ||
      input.planningMode === "reuse"
        ? input.planningMode
        : undefined,
    planningIntervalTicks: finite(input.planningIntervalTicks)
      ? Math.max(1, Math.floor(input.planningIntervalTicks))
      : undefined,
    planningForecastHorizonTicks: finite(input.planningForecastHorizonTicks)
      ? Math.max(1, Math.floor(input.planningForecastHorizonTicks))
      : undefined,
    planningPassesSkipped: finite(input.planningPassesSkipped)
      ? Math.max(0, Math.floor(input.planningPassesSkipped))
      : undefined,
    planningPassesExecuted: finite(input.planningPassesExecuted)
      ? Math.max(0, Math.floor(input.planningPassesExecuted))
      : undefined,
    predictedReadyTick: finite(input.predictedReadyTick)
      ? Math.max(0, Math.floor(input.predictedReadyTick))
      : undefined,
    opponentForecastIntervalTicks: finite(input.opponentForecastIntervalTicks)
      ? Math.max(1, Math.floor(input.opponentForecastIntervalTicks))
      : undefined,
  };
}

export async function readVisualAiTelemetry(): Promise<VisualAiTelemetry | null> {
  try {
    const parsed = JSON.parse(
      await readFile(telemetryPath, "utf8"),
    ) as VisualAiTelemetry;
    if (
      parsed?.version !== 1 ||
      !parsed.latest ||
      !Array.isArray(parsed.history)
    )
      return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function saveVisualAiTelemetry(
  value: unknown,
): Promise<VisualAiTelemetry> {
  const snapshot = parseVisualAiTelemetry(value);
  const operation = saveQueue.then(async () => {
    const existing = await readVisualAiTelemetry();
    const telemetry: VisualAiTelemetry = {
      version: 1,
      latest: snapshot,
      history: [snapshot, ...(existing?.history ?? [])].slice(0, historyLimit),
    };
    await mkdir(path.dirname(telemetryPath), { recursive: true });
    const temporaryPath = `${telemetryPath}.${process.pid}.tmp`;
    // MCP/API consumers format the response themselves. Compact persistence
    // reduces allocations and write volume during long training matches.
    await writeFile(temporaryPath, `${JSON.stringify(telemetry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, telemetryPath);
    return telemetry;
  });
  saveQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
