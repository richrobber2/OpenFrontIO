import { planAdaptivePortActions } from "./AdaptivePortPolicy";
import {
  AiModuleAction,
  AiModuleCoordination,
  AiModuleSignals,
  coordinateModuleDecisions,
  mergeModuleSignals,
} from "./AiModuleCoordinator";
import {
  chooseGoldBudget,
  GoldBudgetContext,
  GoldBudgetDecision,
} from "./GoldBudgetPolicy";
import {
  decideTroopEconomy,
  TroopEconomyContext,
  TroopEconomyDecision,
} from "./TroopEconomyPolicy";

/**
 * Small, stable context passed to optional AI modules. New modules should
 * depend on this normalized data instead of reaching into VisualAiTrainer.
 */
export interface AiModuleContext {
  tick: number;
  reserveRatio: number;
  maxTroops: number;
  troops: number;
  gold: number;
  incomingTroopRatio: number;
  outgoingCommittedRatio: number;
  activeFronts: number;
  neutralLandAvailable: boolean;
  activeNationWars: number;
  borderPressure: number;
  economyReturnScore: number;
  usefulPortSites: number;
  existingPorts: number;
  existingCities: number;
  existingDefensePosts: number;
  existingSams: number;
  existingSilos: number;
  infrastructureNeedScore: number;
  strategicWeaponValue: number;
  allyAidUrgency: number;
  incomePerMinute?: number;
  emergencyGoldFloor?: number;
  incomingStrikeRisk?: number;
  uncoveredCriticalStructures?: number;
  productiveStackSites?: number;
  coastalEconomicTargets?: number;
  enemyWarshipsNearTargets?: number;
  enemyMissileSilos?: number;
  landCapacityGain?: number;
  landRegenerationMultiplier?: number;
  existingFactories?: number;
  factoryConnectedPorts?: number;
  spendableGold?: number;
  portCost?: number;
  tradePartners?: number;
  embargoedPartners?: number;
  ownWarships?: number;
  desiredWarships?: number;
  hostileTransportsNearCoast?: number;
  damagedWarships?: number;
  dockCapacity?: number;
  transportLossRate?: number;
  connectedRailStops?: number;
  railStops?: number;
  navalBias?: number;
  activeFrontRatio?: number;
  tradeCoverageTargetRatio?: number;
}

export interface AiModuleDecision {
  moduleID: string;
  priority: number;
  action: AiModuleAction;
  reason: string;
  data?: Record<string, number | string | boolean>;
  signals?: AiModuleSignals;
}

export interface AiModule {
  readonly id: string;
  readonly priority: number;
  evaluate(
    context: AiModuleContext,
    signals: Readonly<AiModuleSignals>,
  ): AiModuleDecision | null;
}

export class AiModuleRegistry {
  private readonly modules = new Map<string, AiModule>();

  register(module: AiModule): this {
    if (this.modules.has(module.id)) {
      throw new Error(`AI module already registered: ${module.id}`);
    }
    this.modules.set(module.id, module);
    return this;
  }

  unregister(id: string): boolean {
    return this.modules.delete(id);
  }

  list(): readonly AiModule[] {
    return [...this.modules.values()].sort((a, b) => b.priority - a.priority);
  }

  evaluate(context: AiModuleContext): AiModuleDecision[] {
    return this.evaluateCoordinated(context).decisions as AiModuleDecision[];
  }

  evaluateCoordinated(context: AiModuleContext): AiModuleCoordination {
    const decisions: AiModuleDecision[] = [];
    let signals: AiModuleSignals = {};
    for (const module of this.list()) {
      const decision = module.evaluate(context, signals);
      if (decision === null) continue;
      decisions.push(decision);
      signals = mergeModuleSignals(signals, decision.signals);
    }
    return coordinateModuleDecisions(decisions, signals);
  }
}

export class TroopEconomyModule implements AiModule {
  readonly id = "troop-economy";
  readonly priority = 100;

  evaluate(context: AiModuleContext): AiModuleDecision {
    const landExpansionPriority = context.neutralLandAvailable
      ? Math.min(
          1,
          (Math.max(0, context.landCapacityGain ?? 0) /
            Math.max(1, context.maxTroops)) *
            8,
        )
      : 0;
    const reserveFloor = 0.34 + Math.min(0.18, context.activeFronts * 0.05);
    const policy: TroopEconomyContext = {
      reserveRatio: context.reserveRatio,
      reserveFloor,
      incomingTroopRatio: context.incomingTroopRatio,
      outgoingCommittedRatio: context.outgoingCommittedRatio,
      activeFronts: context.activeFronts,
      neutralLandAvailable: context.neutralLandAvailable,
      targetTroopAdvantage: 1.5,
      targetValue: context.neutralLandAvailable
        ? 1 + landExpansionPriority
        : 0.7,
      targetFortificationMultiplier: 1,
    };
    const decision: TroopEconomyDecision = decideTroopEconomy(policy);
    const action =
      decision.action === "attack"
        ? "attack"
        : decision.action === "pulse-expand"
          ? "expand"
          : decision.action === "regenerate"
            ? "hold"
            : "observe";
    return {
      moduleID: this.id,
      priority: this.priority,
      action,
      reason: decision.reason,
      data: { maxCommitFraction: decision.maxCommitFraction },
      signals: {
        troopReserveFloor: reserveFloor,
        maxCommitFraction: decision.maxCommitFraction,
        landExpansionPriority,
      },
    };
  }
}

export class GoldBudgetModule implements AiModule {
  readonly id = "gold-budget";
  readonly priority = 80;

  evaluate(
    context: AiModuleContext,
    signals: Readonly<AiModuleSignals>,
  ): AiModuleDecision {
    const troopReserveStress =
      (signals.troopReserveFloor ?? 0) > context.reserveRatio;
    const policy: GoldBudgetContext = {
      gold: context.gold,
      incomePerMinute: Math.max(0, context.incomePerMinute ?? 0),
      emergencyGoldFloor:
        Math.max(0, context.emergencyGoldFloor ?? 50_000) *
        (troopReserveStress ? 1.2 : 1),
      activeNationWars: context.activeNationWars,
      incomingStrikeRisk: Math.max(0, context.incomingStrikeRisk ?? 0),
      borderPressure: context.borderPressure,
      uncoveredCriticalStructures: Math.max(
        0,
        context.uncoveredCriticalStructures ?? 0,
      ),
      usefulPortSites: context.usefulPortSites,
      existingPorts: context.existingPorts,
      existingCities: context.existingCities,
      existingDefensePosts: context.existingDefensePosts,
      existingSams: context.existingSams,
      existingSilos: context.existingSilos,
      economyReturnScore: context.economyReturnScore,
      navalNeedScore: context.usefulPortSites > context.existingPorts ? 4 : 0,
      strategicWeaponValue: context.strategicWeaponValue,
      infrastructureNeedScore: context.infrastructureNeedScore,
      allyAidUrgency: context.allyAidUrgency,
      recentLowValuePurchases: 0,
      productiveStackSites: context.productiveStackSites,
      coastalEconomicTargets: context.coastalEconomicTargets,
      enemyWarshipsNearTargets: context.enemyWarshipsNearTargets,
      enemyMissileSilos: context.enemyMissileSilos,
    };
    const decision: GoldBudgetDecision = chooseGoldBudget(policy);
    return {
      moduleID: this.id,
      priority: this.priority,
      action: decision.category === "hold" ? "hold" : "invest",
      reason: decision.reason,
      data: {
        category: decision.category,
        spendCap: decision.spendCap,
        reserveFloor: decision.reserveFloor,
        minimumQueuedPurchases: decision.minimumQueuedPurchases,
        allowProductiveStacking: decision.allowProductiveStacking,
      },
      signals: {
        goldReserveFloor: decision.reserveFloor,
        goldSpendCap: decision.spendCap,
        goldMinimumQueuedPurchases: decision.minimumQueuedPurchases,
        goldCategory: decision.category,
        allowProductiveStacking: decision.allowProductiveStacking,
      },
    };
  }
}

export class NavalEconomyModule implements AiModule {
  readonly id = "naval-economy";
  readonly priority = 60;

  evaluate(
    context: AiModuleContext,
    signals: Readonly<AiModuleSignals>,
  ): AiModuleDecision {
    const connectedPorts = Math.max(0, context.factoryConnectedPorts ?? 0);
    const unconnectedPorts = Math.max(
      0,
      context.existingPorts - connectedPorts,
    );
    const portPlan = planAdaptivePortActions({
      reserveRatio: context.reserveRatio,
      incomingPressureRatio: context.incomingTroopRatio,
      activeFrontRatio: Math.max(
        0,
        Math.min(1, context.activeFrontRatio ?? context.activeFronts / 4),
      ),
      gold: context.gold,
      spendableGold: Math.max(0, context.spendableGold ?? 0),
      portCost: Math.max(0, context.portCost ?? 0),
      ports: context.existingPorts,
      connectedPorts,
      tradePartners: Math.max(0, context.tradePartners ?? 0),
      embargoedPartners: Math.max(0, context.embargoedPartners ?? 0),
      ownWarships: Math.max(0, context.ownWarships ?? 0),
      desiredWarships: Math.max(0, context.desiredWarships ?? 0),
      hostileWarships: Math.max(0, context.enemyWarshipsNearTargets ?? 0),
      hostileTransports: Math.max(0, context.hostileTransportsNearCoast ?? 0),
      tradeTargets: Math.max(0, context.coastalEconomicTargets ?? 0),
      damagedWarships: Math.max(0, context.damagedWarships ?? 0),
      dockCapacity: Math.max(0, context.dockCapacity ?? 0),
      transportLossRate: Math.max(0, context.transportLossRate ?? 0),
      railProductivityRatio:
        (context.railStops ?? 0) <= 0
          ? 0
          : Math.min(
              1,
              Math.max(
                0,
                (context.connectedRailStops ?? 0) /
                  Math.max(1, context.railStops ?? 0),
              ),
            ),
      navalBias: Math.max(0, context.navalBias ?? 1),
      economicTradeCoverageTargetRatio: context.tradeCoverageTargetRatio,
    });
    const factoryConnectionPriority =
      portPlan.action === "connect"
        ? portPlan.urgency
        : 1 - portPlan.connectedPortRatio;
    const shipyardBuildAllowed =
      (portPlan.action === "defend" || portPlan.action === "trade") &&
      portPlan.budgetCoverageRatio >= portPlan.minimumBudgetCoverage;
    const goal =
      portPlan.action === "connect"
        ? "connect-existing-shipyard"
        : portPlan.action === "repair"
          ? "increase-repair-throughput"
          : shipyardBuildAllowed
            ? "factory-connected-shipyard"
            : "observe-coast";

    return {
      moduleID: this.id,
      priority: this.priority,
      action: portPlan.action === "hold" ? "observe" : "invest",
      reason: portPlan.reason,
      data: {
        connectedPorts,
        unconnectedPorts,
        portAction: portPlan.action,
        portActionUrgency: portPlan.urgency,
        portBudgetCoverageRatio: portPlan.budgetCoverageRatio,
        portConnectedRatio: portPlan.connectedPortRatio,
        portFleetCoverageRatio: portPlan.fleetCoverageRatio,
        portRepairLoadRatio: portPlan.repairLoadRatio,
        portThreatRatio: portPlan.navalThreatRatio,
        portTradeCoverageRatio: portPlan.tradeCoverageRatio,
      },
      signals: {
        shipyardFactoryConnectionPriority: factoryConnectionPriority,
        shipyardBuildAllowed,
        navalInfrastructureGoal: goal,
        portAction: portPlan.action,
        portActionUrgency: portPlan.urgency,
        portBudgetCoverageRatio: portPlan.budgetCoverageRatio,
        portConnectedRatio: portPlan.connectedPortRatio,
        portFleetCoverageRatio: portPlan.fleetCoverageRatio,
        portRepairLoadRatio: portPlan.repairLoadRatio,
        portThreatRatio: portPlan.navalThreatRatio,
        portTradeCoverageRatio: portPlan.tradeCoverageRatio,
        portCandidateSampleRatio: portPlan.candidateSampleRatio,
        portTargetCoverageRatio: portPlan.targetCoverageRatio,
        portTargetPartnerCoverageRatio: portPlan.targetPartnerCoverageRatio,
        portMinimumSiteQuality: portPlan.minimumSiteQuality,
        portMinimumBudgetCoverage: portPlan.minimumBudgetCoverage,
        portRequiredReturnRatio: portPlan.requiredReturnRatio,
        portMaximumPaybackTicks: portPlan.maximumPaybackTicks,
        portRepairHealthThreshold: portPlan.repairHealthThreshold,
        portStackingLoadThreshold: portPlan.stackingLoadThreshold,
        portRequireFactoryConnection:
          portPlan.requireFactoryConnection &&
          (context.existingFactories ?? 0) > 0,
        portConstructionPressure: portPlan.constructionPressure,
      },
    };
  }
}

export function createDefaultAiModuleRegistry(): AiModuleRegistry {
  return new AiModuleRegistry()
    .register(new TroopEconomyModule())
    .register(new GoldBudgetModule())
    .register(new NavalEconomyModule());
}
