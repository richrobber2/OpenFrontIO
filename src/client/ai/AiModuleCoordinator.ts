export type AiModuleAction =
  | "hold"
  | "invest"
  | "expand"
  | "attack"
  | "observe";

export type AiModuleSignals = {
  troopReserveFloor?: number;
  maxCommitFraction?: number;
  landExpansionPriority?: number;
  goldReserveFloor?: number;
  goldSpendCap?: number;
  goldCategory?: string;
  allowProductiveStacking?: boolean;
  shipyardFactoryConnectionPriority?: number;
  shipyardBuildAllowed?: boolean;
  navalInfrastructureGoal?: string;
  portAction?: string;
  portActionUrgency?: number;
  portBudgetCoverageRatio?: number;
  portConnectedRatio?: number;
  portFleetCoverageRatio?: number;
  portRepairLoadRatio?: number;
  portThreatRatio?: number;
  portTradeCoverageRatio?: number;
  portCandidateSampleRatio?: number;
  portTargetCoverageRatio?: number;
  portTargetPartnerCoverageRatio?: number;
  portMinimumSiteQuality?: number;
  portMinimumBudgetCoverage?: number;
  portRequiredReturnRatio?: number;
  portMaximumPaybackTicks?: number;
  portRepairHealthThreshold?: number;
  portStackingLoadThreshold?: number;
  portRequireFactoryConnection?: boolean;
  portConstructionPressure?: number;
};

export type CoordinatedModuleDecision = {
  moduleID: string;
  priority: number;
  action: AiModuleAction;
  reason: string;
  data?: Record<string, number | string | boolean>;
  signals?: AiModuleSignals;
};

export type AiModuleCoordination = {
  decisions: CoordinatedModuleDecision[];
  signals: AiModuleSignals;
  consensusAction: AiModuleAction;
  preferredInvestment: string;
  reasons: string[];
};

export function mergeModuleSignals(
  current: Readonly<AiModuleSignals>,
  next: Readonly<AiModuleSignals> | undefined,
): AiModuleSignals {
  return next === undefined ? { ...current } : { ...current, ...next };
}

export function coordinateModuleDecisions(
  decisions: CoordinatedModuleDecision[],
  signals: AiModuleSignals,
): AiModuleCoordination {
  const byPriority = [...decisions].sort((a, b) => b.priority - a.priority);
  const reserveVeto = byPriority.find(
    (decision) => decision.action === "hold" && decision.priority >= 90,
  );
  const attack = byPriority.find((decision) => decision.action === "attack");
  const expand = byPriority.find((decision) => decision.action === "expand");
  const invest = byPriority.find((decision) => decision.action === "invest");
  const consensusAction: AiModuleAction =
    reserveVeto !== undefined
      ? "hold"
      : attack !== undefined
        ? "attack"
        : (signals.landExpansionPriority ?? 0) >= 0.35 || expand !== undefined
          ? "expand"
          : (invest?.action ?? "observe");
  const preferredInvestment =
    signals.portAction === "connect" ||
    (signals.shipyardFactoryConnectionPriority ?? 0) >= 0.5
      ? (signals.navalInfrastructureGoal ?? "factory-connected-shipyard")
      : (signals.goldCategory ?? "none");

  return {
    decisions: byPriority,
    signals,
    consensusAction,
    preferredInvestment,
    reasons: byPriority.map(
      (decision) => `${decision.moduleID}: ${decision.reason}`,
    ),
  };
}
