import { EventBus } from "../../core/EventBus";
import {
  ATTACK_RETREAT_DELAY_TICKS,
  ATTACK_RETREAT_MALUS_PERCENT,
} from "../../core/execution/AttackRetreatRules";
import { computeNukeBlastCounts } from "../../core/execution/Util";
import {
  PlayerBuildableUnitType,
  PlayerType,
  TerrainType,
  UnitType,
} from "../../core/game/Game";
import {
  AllianceRequestUpdate,
  GameUpdateType,
  WinUpdate,
} from "../../core/game/GameUpdates";
import { UniversalPathFinding } from "../../core/pathfinding/PathFinder";
import { BOAT_INDEX_ARRIVE, BOAT_INDEX_DESTROY } from "../../core/StatsSchemas";
import { AttackRatioEvent, ReplaySpeedChangeEvent } from "../InputHandler";
import { GoToPlayerEvent, GoToUnitEvent } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  MoveWarshipIntentEvent,
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendQuickChatEvent,
  SendSpawnIntentEvent,
  SendTargetPlayerIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { ReplaySpeedMultiplier } from "../utilities/ReplaySpeedMultiplier";
import { renderTroops } from "../Utils";
import { GameView, PlayerView } from "../view";
import {
  ActionRewardBaseline,
  applyActionOutcomeLearning,
  normalizeActionReward,
  scoreCounterfactualActionOutcome,
  scoreDelayedActionOutcome,
} from "./ActionOutcomeLearning";
import { rankAdaptiveTradePortOptions } from "./AdaptivePortPolicy";
import { createDefaultAiModuleRegistry } from "./AiModule";
import { AiModuleCoordination, AiModuleSignals } from "./AiModuleCoordinator";
import {
  AllianceCooperationAssessment,
  allianceResponseWindowTicks,
  assessAllianceCooperation,
} from "./AllianceCooperationPolicy";
import {
  AllianceLifecycleAction,
  planAllianceLifecycle,
} from "./AllianceLifecyclePolicy";
import {
  planCoalitionGrowthSupport,
  selectCoalitionTarget,
} from "./CoalitionPlanningPolicy";
import { CommunicationAction, planCommunication } from "./CommunicationPlanner";
import {
  AdaptivePlanningMode,
  AdaptivePlanningObservation,
  defensiveCounterBudget,
  estimateTicksUntilReserve,
  evaluateRaidRecallDefense,
  factoryOpportunityRetryTick,
  navalConstructionRetryTick,
  planAdaptivePlanningCadence,
  shouldLaunchDefensiveCounter,
  shouldPreFortifyInfrastructure,
  shouldPublishTelemetry,
  shouldTriggerEmergencyCity,
  shouldTriggerIdleGrowth,
} from "./DecisionTriggerPolicy";
import {
  hostileFrontDefensePriority,
  STRATEGIC_LAND_STRUCTURE_TYPES,
} from "./DefensePlacementPolicy";
import { DIPLOMACY_MESSAGE_COOLDOWN_TICKS } from "./DiplomacyPolicy";
import { updateRecurringIncomeEstimate } from "./EconomicIncomePolicy";
import {
  capacityEscapeCityBudget,
  EconomicSystemPlan,
  planEconomicSystems,
  selectFactoryUpgradeCandidates,
  shouldFundFirstPressureFactory,
} from "./EconomicSystemPolicy";
import { isWithinRailConnectionRange } from "./InfrastructureConnectionPolicy";
import {
  LandCapacityProjection,
  projectLandCapacity,
} from "./LandCapacityPolicy";
import {
  fleetCombatPower,
  NAVAL_CLASH_ADVANTAGE,
  selectWarshipDeployment,
  warshipHealthRatio,
} from "./NavalCombatPolicy";
import { planShipyardPlacements } from "./NavalStrategicPressurePolicy";
import {
  forecastOpponent,
  OpponentForecast,
  OpponentObservation,
} from "./OpponentForecastPolicy";
import {
  earlyPortSeizureValue,
  isNavalRemnantOpportunity,
  maximumNavalInterceptionRisk,
  minimumNavalLaunchReserveRatio,
  navalLaunchDelayTicks,
  overseasExpansionValue,
  preferTribeExpansionTargets,
  prioritizePortLandingTiles,
  transportRecallThreshold,
} from "./OverseasExpansionPolicy";
import { planRemnantConquest } from "./RemnantConquestPolicy";
import {
  samPlacementProtectionRadius,
  scoreSamPlacement,
} from "./SamPlacementPolicy";
import { sampleCoastalAccess, scoreTrainingSpawn } from "./SpawnStrategyPolicy";
import {
  modelOpponent,
  OpponentModel,
  planStrategicAction,
  StrategicPlan,
} from "./StrategicActionPlanner";
import {
  assessBridgeheadLaunch,
  assessGrowthAwareLandGrab,
} from "./StrategicPressurePolicy";
import { evaluateStrategicSurvival } from "./StrategicSurvivalPolicy";
import {
  assessStrategicRoute,
  assessStrategicStrike,
  countReadySiloSlots,
  estimateConventionalNukeTroopLoss,
  planStrategicCapability,
  STRATEGIC_STRIKE_COOLDOWN_TICKS,
  StrategicCapabilityPlan,
} from "./StrategicWeaponsPolicy";
import {
  assessAttackCapacity,
  classifyLossCause,
  desiredBankedTroops,
  desiredCapacityEscapeCityCount,
  desiredDefensiveCityCount,
  desiredFactoryCount,
  desiredFleetTroopBank,
  desiredWarshipCount,
  estimateLandAttackTicks,
  estimateTradeRouteGold,
  evaluateSeedCohort,
  isStrategicallyTrapped,
  LossCause,
  minimumDefensePostDepth,
  nationFrontPolicy,
  nationLandFrontAllowed,
  planCapacityEscapeRaid,
  predictFutureOutcomes,
  PredictionAction,
  railCityConnectionScore,
  scoreCityStackPlacement,
  scoreFactoryPlacement,
  scoreMutationOutcome,
  shouldAcceptAlliance,
  shouldRiskDenialRaid,
  shouldTradeLandForTime,
  tribeAttackCommitmentMultiplier,
} from "./StrategyMath";
import { planContestedTribeOpportunity } from "./TribeOpportunityPolicy";
import { assessMaxPushRisk } from "./TroopEconomyPolicy";
import { planWildernessExpansion } from "./WildernessExpansionPolicy";

type TrainerSnapshot = {
  tick: number;
  status:
    | "loading"
    | "spawning"
    | "running"
    | "thinking"
    | "paused"
    | "restarting";
  decision: string;
  detail: string;
  troops: number;
  maxTroops: number;
  gold: number;
  tiles: number;
  territoryShare: number;
  lesson: number;
  transportShips: number;
  warships: number;
  fleetTroops: number;
  incomingFronts: number;
  incomingTroops: number;
  outgoingFronts: number;
  nationsAlive: number;
  tribesAlive: number;
  humansAlive: number;
  opponentsAlive: number;
  totalOpponents: number;
  learnedMatches: number;
  mutationGeneration: number;
  aggressionGene: number;
  cautionGene: number;
  navalGene: number;
  candidateBaselineScore: number;
  bestMutationScore: number;
  candidateSeedMatches: number;
  candidateSeedTarget: number;
  raidSuccessRate: number;
  retaliationRate: number;
  transportLossRate: number;
  brainStorage: string;
  brainRevision: number;
  lastLossCause: string;
  history: TrainerTrace[];
};

type NavalSituation = {
  ownedShores: number[];
  hostileWarships: ReturnType<GameView["units"]>;
  hostileTransports: ReturnType<GameView["units"]>;
  tradeTargets: ReturnType<GameView["units"]>;
  navalPressureRatio: number;
  tradeOpportunityRatio: number;
};

type TrainerTrace = {
  tick: number;
  decision: string;
  detail: string;
  count: number;
};

type TrainingChoice =
  | "land-attack"
  | "expansion"
  | "naval"
  | "strategic"
  | "diplomacy";

type LandFrontIntel = {
  contactTile: number;
  borderWidth: number;
  averageSpeedCost: number;
  averageLossCost: number;
  defendedContactRatio: number;
  wrapPotential: number;
  terrainLabel: string;
};

type MatchTelemetry = {
  startedTick: number;
  lastObservedTick: number;
  startingTiles: number;
  lastTiles: number;
  lastGainTick: number;
  peakTiles: number;
  lowReserveTicks: number;
  thirdPartyPressureTicks: number;
  currentStallTicks: number;
  longestStallTicks: number;
  currentNoGrowthTicks: number;
  longestNoGrowthTicks: number;
  maxIncomingRatio: number;
  maxCommittedRatio: number;
  peakCities: number;
  peakFactories: number;
  peakDefensePosts: number;
  decisionCycles: number;
};

type AllyCooperationRecord = {
  allianceCreatedAt: number;
  requestsSent: number;
  requestsAnswered: number;
  ignoredRequests: number;
  sharedFrontSamples: number;
  sharedFrontResponses: number;
  unpromptedAidEvents: number;
  receivedGold: number;
  receivedTroops: number;
  lastObservedTick: number;
  lastRequestTick: number;
  lastMessageTick: number;
  lastThanksTick: number;
  lastAidTick: number;
  lastDonationTick: number;
  pending?: {
    kind: "aid" | "focus";
    sentTick: number;
    targetSmallID?: number;
  };
};

type LearningProfile = {
  saveRevision: number;
  savedAt: number;
  matches: number;
  wins: number;
  eliminations: number;
  raidAttempts: number;
  raidSuccesses: number;
  raidRetaliations: number;
  transportArrivals: number;
  transportDestroyed: number;
  finishingRankTotal: number;
  mutationGeneration: number;
  aggressionGene: number;
  cautionGene: number;
  navalGene: number;
  candidateAggressionGene: number;
  candidateCautionGene: number;
  candidateNavalGene: number;
  candidateBaselineScore: number;
  candidateActive: number;
  candidateSeedScoreTotal: number;
  candidateSeedMatches: number;
  bestMutationScore: number;
  lastLossCause: number;
  lossOverextension: number;
  lossThirdParty: number;
  lossStalledOffense: number;
  lossContainment: number;
  lossInfrastructure: number;
  predictionReward: number;
  predictionError: number;
  predictionCount: number;
  actionOutcomeSamples: number;
  actionOutcomeReward: number;
  actionRewardBaselines: Record<PredictionAction, ActionRewardBaseline>;
  recentMatchResults: Array<"win" | "loss">;
  actionHistory: ActionHistoryEntry[];
};

type ActionHistoryEntry = {
  tick: number;
  action: PredictionAction;
  reserveRatio: number;
  enemyRatio: number;
  expectedTroops: number;
  expectedTiles: number;
  actualTroops?: number;
  actualTiles?: number;
  error?: number;
  startingGold?: number;
  startingTiles?: number;
  startingTroops?: number;
  startingMaxTroops?: number;
  settleTick?: number;
  outcomeReward?: number;
  attributionWeight?: number;
};

// v2 intentionally starts clean after the strength-relative naval, veterancy,
// MIRV-defense, economic-placement, and prediction tools were wired in.
const LEARNING_STORAGE_KEY = "openfront.visualAiLearning.v2";
const MUTATION_SEED_COHORT_SIZE = 4;
const OPPONENT_FORECAST_INTERVAL_TICKS = 5;
const EMPTY_LEARNING: LearningProfile = {
  saveRevision: 0,
  savedAt: 0,
  matches: 0,
  wins: 0,
  eliminations: 0,
  raidAttempts: 0,
  raidSuccesses: 0,
  raidRetaliations: 0,
  transportArrivals: 0,
  transportDestroyed: 0,
  finishingRankTotal: 0,
  mutationGeneration: 0,
  aggressionGene: 0,
  cautionGene: 0,
  navalGene: 0,
  candidateAggressionGene: 0,
  candidateCautionGene: 0,
  candidateNavalGene: 0,
  candidateBaselineScore: 0,
  candidateActive: 0,
  candidateSeedScoreTotal: 0,
  candidateSeedMatches: 0,
  bestMutationScore: 0,
  lastLossCause: LossCause.Unknown,
  lossOverextension: 0,
  lossThirdParty: 0,
  lossStalledOffense: 0,
  lossContainment: 0,
  lossInfrastructure: 0,
  predictionReward: 0,
  predictionError: 0,
  predictionCount: 0,
  actionOutcomeSamples: 0,
  actionOutcomeReward: 0,
  actionRewardBaselines: {
    attack: { mean: 0, samples: 0 },
    expand: { mean: 0, samples: 0 },
    fleet: { mean: 0, samples: 0 },
    defend: { mean: 0, samples: 0 },
    hold: { mean: 0, samples: 0 },
  },
  recentMatchResults: [],
  actionHistory: [],
};

function normalizeLearning(value: unknown): LearningProfile {
  const saved =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const normalized = Object.fromEntries(
    Object.entries(EMPTY_LEARNING).map(([key, fallback]) => {
      const candidate = saved[key];
      return [
        key,
        typeof candidate === "number" && Number.isFinite(candidate)
          ? candidate
          : fallback,
      ];
    }),
  ) as LearningProfile;
  const savedHistory = saved.actionHistory;
  normalized.actionHistory = Array.isArray(savedHistory)
    ? savedHistory
        .filter(
          (entry): entry is ActionHistoryEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as ActionHistoryEntry).tick === "number" &&
            typeof (entry as ActionHistoryEntry).action === "string",
        )
        .slice(-128)
    : [];
  const savedBaselines = saved.actionRewardBaselines;
  normalized.actionRewardBaselines = Object.fromEntries(
    (["attack", "expand", "fleet", "defend", "hold"] as const).map((action) => {
      const candidate =
        typeof savedBaselines === "object" && savedBaselines !== null
          ? (savedBaselines as Record<string, unknown>)[action]
          : undefined;
      const record =
        typeof candidate === "object" && candidate !== null
          ? (candidate as Record<string, unknown>)
          : {};
      return [
        action,
        {
          mean:
            typeof record.mean === "number" && Number.isFinite(record.mean)
              ? Math.max(-1, Math.min(1, record.mean))
              : 0,
          samples:
            typeof record.samples === "number" &&
            Number.isFinite(record.samples)
              ? Math.max(0, Math.min(10_000, Math.floor(record.samples)))
              : 0,
        },
      ];
    }),
  ) as Record<PredictionAction, ActionRewardBaseline>;
  normalized.recentMatchResults = Array.isArray(saved.recentMatchResults)
    ? saved.recentMatchResults
        .filter(
          (result): result is "win" | "loss" =>
            result === "win" || result === "loss",
        )
        .slice(-20)
    : [];
  return normalized;
}

function loadLearning(): LearningProfile {
  try {
    return normalizeLearning(
      JSON.parse(localStorage.getItem(LEARNING_STORAGE_KEY) ?? "{}"),
    );
  } catch {
    return { ...EMPTY_LEARNING };
  }
}

class AiTrainingOverlay extends HTMLElement {
  private decision!: HTMLElement;
  private detail!: HTMLElement;
  private metrics!: HTMLElement;
  private progress!: HTMLElement;
  private pauseButton!: HTMLButtonElement;
  private followButton!: HTMLButtonElement;
  private insightsButton!: HTMLButtonElement;
  private copyButton!: HTMLButtonElement;
  private insights!: HTMLElement;
  private status!: HTMLElement;
  private situation!: HTMLElement;
  private learning!: HTMLElement;
  private history!: HTMLElement;
  private lastSnapshot: TrainerSnapshot | null = null;

  public paused = false;
  public followCamera = true;
  public onPauseChange: ((paused: boolean) => void) | null = null;

  connectedCallback(): void {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          position: fixed;
          z-index: 100000;
          top: max(12px, env(safe-area-inset-top));
          left: 50%;
          width: min(390px, calc(100vw - 24px));
          transform: translateX(-50%);
          color: #f8fafc;
          font: 500 13px/1.35 system-ui, sans-serif;
          pointer-events: none;
        }
        .panel {
          overflow: hidden;
          border: 1px solid rgb(167 139 250 / 45%);
          border-radius: 14px;
          background: rgb(15 23 42 / 90%);
          box-shadow: 0 14px 38px rgb(0 0 0 / 35%);
          backdrop-filter: blur(14px);
          pointer-events: auto;
        }
        .head, .body, .actions, .insights { padding: 10px 12px; }
        .head, .actions { display: flex; align-items: center; gap: 8px; }
        .head { justify-content: space-between; border-bottom: 1px solid rgb(148 163 184 / 16%); }
        .title { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        .live { color: #86efac; font-size: 11px; font-weight: 750; }
        .live[data-status="thinking"] { color: #67e8f9; }
        .live[data-status="loading"], .live[data-status="paused"], .live[data-status="spawning"] { color: #fde68a; }
        .live[data-status="restarting"] { color: #fca5a5; }
        .decision { font-size: 16px; font-weight: 750; }
        .detail { margin-top: 3px; color: #cbd5e1; }
        .metrics { margin-top: 8px; color: #a5b4fc; font-variant-numeric: tabular-nums; }
        .track { height: 4px; background: rgb(148 163 184 / 18%); }
        .progress { height: 100%; width: 0; background: linear-gradient(90deg, #8b5cf6, #22d3ee); transition: width 180ms ease; }
        .insights { display: none; max-height: min(50vh, 390px); overflow: auto; border-top: 1px solid rgb(148 163 184 / 16%); overscroll-behavior: contain; }
        .insights.open { display: block; }
        .section + .section { margin-top: 10px; }
        .label { margin-bottom: 5px; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
        .card { min-width: 0; padding: 7px 8px; border-radius: 8px; background: rgb(30 41 59 / 68%); color: #cbd5e1; font-size: 11px; font-variant-numeric: tabular-nums; }
        .card strong { display: block; margin-bottom: 2px; color: #f8fafc; font-size: 13px; }
        .trace { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; padding: 6px 0; border-top: 1px solid rgb(148 163 184 / 12%); }
        .trace:first-child { border-top: 0; }
        .trace time { color: #818cf8; font: 700 10px ui-monospace, monospace; }
        .trace strong, .trace small { display: block; }
        .trace strong { color: #e2e8f0; font-size: 11px; }
        .trace small { margin-top: 2px; overflow: hidden; color: #94a3b8; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .actions { justify-content: flex-end; flex-wrap: wrap; border-top: 1px solid rgb(148 163 184 / 16%); }
        button {
          border: 1px solid rgb(148 163 184 / 28%);
          border-radius: 999px;
          padding: 5px 9px;
          color: inherit;
          background: rgb(30 41 59 / 80%);
          font: inherit;
        }
        @media (max-height: 520px) {
          :host { top: 6px; width: min(470px, calc(100vw - 12px)); }
          .head, .body, .actions, .insights { padding: 6px 9px; }
          .detail { display: none; }
          .insights { max-height: 42vh; }
        }
      </style>
      <section class="panel" aria-live="polite">
        <div class="head"><span class="title">Codex AI trainer</span><span class="live">● SPAWNING</span></div>
        <div class="body">
          <div class="decision">Preparing lesson…</div>
          <div class="detail">Waiting for the random spawn to complete.</div>
          <div class="metrics">Tick 0 · Lesson 0</div>
        </div>
        <div class="track"><div class="progress"></div></div>
        <div class="insights">
          <div class="section"><div class="label">Live situation</div><div class="grid situation"></div></div>
          <div class="section"><div class="label">Learning policy</div><div class="grid learning"></div></div>
          <div class="section"><div class="label">Recent decisions</div><div class="history"></div></div>
        </div>
        <div class="actions">
          <button class="copy" type="button">Copy report</button>
          <button class="insights-toggle" type="button" aria-expanded="false">Insights</button>
          <button class="follow" type="button">Camera: follow</button>
          <button class="pause" type="button">Pause AI</button>
        </div>
      </section>`;
    this.decision = root.querySelector(".decision")!;
    this.detail = root.querySelector(".detail")!;
    this.metrics = root.querySelector(".metrics")!;
    this.progress = root.querySelector(".progress")!;
    this.insights = root.querySelector(".insights")!;
    this.status = root.querySelector(".live")!;
    this.situation = root.querySelector(".situation")!;
    this.learning = root.querySelector(".learning")!;
    this.history = root.querySelector(".history")!;
    this.pauseButton = root.querySelector(".pause")!;
    this.followButton = root.querySelector(".follow")!;
    this.insightsButton = root.querySelector(".insights-toggle")!;
    this.copyButton = root.querySelector(".copy")!;
    this.pauseButton.addEventListener("click", () => {
      this.paused = !this.paused;
      this.pauseButton.textContent = this.paused ? "Resume AI" : "Pause AI";
      this.onPauseChange?.(this.paused);
    });
    this.followButton.addEventListener("click", () => {
      this.followCamera = !this.followCamera;
      this.followButton.textContent = this.followCamera
        ? "Camera: follow"
        : "Camera: free";
    });
    this.insightsButton.addEventListener("click", () => {
      const open = this.insights.classList.toggle("open");
      this.insightsButton.setAttribute("aria-expanded", String(open));
      this.insightsButton.textContent = open ? "Hide insights" : "Insights";
    });
    this.copyButton.addEventListener("click", () => void this.copyReport());
  }

  updateSnapshot(snapshot: TrainerSnapshot): void {
    this.lastSnapshot = snapshot;
    this.decision.textContent = snapshot.decision;
    this.detail.textContent = snapshot.detail;
    this.status.dataset.status = snapshot.status;
    this.status.textContent = `● ${snapshot.status.toUpperCase()}`;
    const fleet =
      snapshot.transportShips > 0
        ? ` · ${snapshot.transportShips} transports carrying ${renderTroops(snapshot.fleetTroops)}`
        : "";
    this.metrics.textContent = `Tick ${snapshot.tick.toLocaleString()} · Lesson ${snapshot.lesson} · generation ${snapshot.mutationGeneration} from ${snapshot.learnedMatches} match${snapshot.learnedMatches === 1 ? "" : "es"} · ${snapshot.opponentsAlive}/${snapshot.totalOpponents} rivals · ${renderTroops(snapshot.troops)} home troops · ${snapshot.tiles.toLocaleString()} tiles${fleet}`;
    this.progress.style.width = `${Math.max(0, Math.min(100, snapshot.territoryShare * 100))}%`;
    this.replaceCards(this.situation, [
      [
        `${Math.round((snapshot.troops / Math.max(1, snapshot.maxTroops)) * 100)}% reserve`,
        `${renderTroops(snapshot.troops)} / ${renderTroops(snapshot.maxTroops)} troops`,
      ],
      [
        `${snapshot.incomingFronts} in · ${snapshot.outgoingFronts} out`,
        `${renderTroops(snapshot.incomingTroops)} incoming troops`,
      ],
      [
        `${snapshot.nationsAlive} / ${snapshot.tribesAlive} / ${snapshot.humansAlive}`,
        "nations / tribes / humans alive",
      ],
      [
        `${Math.floor(snapshot.gold).toLocaleString()} gold`,
        `${snapshot.warships} warships · ${snapshot.transportShips} transports · ${renderTroops(snapshot.fleetTroops)} embarked`,
      ],
    ]);
    this.replaceCards(this.learning, [
      [
        `A ${snapshot.aggressionGene.toFixed(2)} · C ${snapshot.cautionGene.toFixed(2)} · N ${snapshot.navalGene.toFixed(2)}`,
        "active aggression / caution / naval genes",
      ],
      [
        `Seed ${snapshot.candidateSeedMatches}/${snapshot.candidateSeedTarget}`,
        `${snapshot.candidateBaselineScore.toFixed(0)} baseline → ${snapshot.bestMutationScore.toFixed(0)} best average`,
      ],
      [
        `${Math.round(snapshot.raidSuccessRate * 100)}% success`,
        `${Math.round(snapshot.retaliationRate * 100)}% retaliation after probes`,
      ],
      [
        `${Math.round(snapshot.transportLossRate * 100)}% transport loss`,
        `${snapshot.learnedMatches} evaluated matches`,
      ],
      [snapshot.brainStorage, `brain revision ${snapshot.brainRevision}`],
      [snapshot.lastLossCause, "most recent loss diagnosis"],
    ]);
    this.history.replaceChildren(
      ...snapshot.history.map((entry) => {
        const row = document.createElement("div");
        row.className = "trace";
        const time = document.createElement("time");
        time.textContent = `T${entry.tick}${entry.count > 1 ? ` ×${entry.count}` : ""}`;
        const copy = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = entry.decision;
        const detail = document.createElement("small");
        detail.textContent = entry.detail;
        copy.append(title, detail);
        row.append(time, copy);
        return row;
      }),
    );
  }

  private replaceCards(target: HTMLElement, cards: [string, string][]): void {
    target.replaceChildren(
      ...cards.map(([value, label]) => {
        const card = document.createElement("div");
        card.className = "card";
        const strong = document.createElement("strong");
        strong.textContent = value;
        card.append(strong, label);
        return card;
      }),
    );
  }

  private async copyReport(): Promise<void> {
    if (this.lastSnapshot === null) return;
    const original = this.copyButton.textContent;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { capturedAt: new Date().toISOString(), ...this.lastSnapshot },
          null,
          2,
        ),
      );
      this.copyButton.textContent = "Copied";
    } catch {
      this.copyButton.textContent = "Copy failed";
    }
    window.setTimeout(() => (this.copyButton.textContent = original), 1_500);
  }
}

if (!customElements.get("ai-training-overlay")) {
  customElements.define("ai-training-overlay", AiTrainingOverlay);
}

export class VisualAiTrainer {
  private readonly learning = loadLearning();
  private readonly aiModules = createDefaultAiModuleRegistry();
  private readonly overlay = document.createElement(
    "ai-training-overlay",
  ) as AiTrainingOverlay;
  private nextDecisionTick = 0;
  private lastPlanningTick = Number.NEGATIVE_INFINITY;
  private lastPlanningObservation: AdaptivePlanningObservation | undefined;
  private adaptivePlanningMode: AdaptivePlanningMode = "reactive";
  private adaptivePlanningIntervalTicks = 1;
  private adaptivePlanningForecastHorizonTicks = 30;
  private adaptivePlanningPassesSkipped = 0;
  private adaptivePlanningPassesExecuted = 0;
  private predictedReadyTick: number | undefined;
  private forceOpponentForecastRefresh = true;
  private opponentForecastIntervalTicks = OPPONENT_FORECAST_INTERVAL_TICKS;
  private nextDiplomacyTick = 0;
  private readonly handledAllianceRequests = new Set<string>();
  private readonly pendingAllianceAcceptances = new Set<number>();
  private readonly handledAllianceExtensions = new Set<string>();
  private readonly declinedAllianceExtensions = new Set<string>();
  private readonly allianceCooldownUntil = new Map<string, number>();
  private readonly allyCooperation = new Map<string, AllyCooperationRecord>();
  private nextAllianceCoordinationTick = 0;
  private latestAllianceAction: AllianceLifecycleAction | "none" = "none";
  private latestAllyReliability = 0.5;
  private latestTrustedAllies = 0;
  private latestCoalitionTargetId: string | undefined;
  private latestCoalitionTargetCostMultiplier = 1;
  private latestCoalitionTarget: string | undefined;
  private latestCoalitionHelpers = 0;
  private latestCoalitionTreatyBlocks = 0;
  private coalitionGrowthDonations = 0;
  private latestCoalitionGrowthGain = 1;
  private lastStrategicStrikeTick = Number.NEGATIVE_INFINITY;
  private strategicCollateralRejections = 0;
  private strategicCapability: StrategicCapabilityPlan | undefined;
  private strategicCandidateCount = 0;
  private strategicLaunches = 0;
  private strategicSiloBuilds = 0;
  private strategicRouteRejections = 0;
  private lastStrategicStatus = "not evaluated";
  private lastStrategicTarget: string | undefined;
  private lastStrategicWeapon: string | undefined;
  private lastStrategicScore: number | undefined;
  private pendingStrategicStrike:
    | {
        targetSmallID: number;
        targetName: string;
        targetTroops: number;
        targetTiles: number;
        targetStructures: number;
        evaluateTick: number;
      }
    | undefined;
  private lastStrategicOutcome: string | undefined;
  private nextRaidTick = 0;
  private nextBoatTick = 0;
  private nextNavalConstructionTick = 0;
  private nextFactoryOpportunityTick = 0;
  private nextEmergencyCityTick = 0;
  private lastSpawnRequestTick = Number.NEGATIVE_INFINITY;
  private readonly attemptedSpawnTiles = new Set<number>();
  private verifiedNationBorders = new Set<string>();
  private readonly hostileNationIDs = new Set<string>();
  private followTransportUntil = 0;
  private nextTransportCameraTick = 0;
  private retreatingTransports = new Set<number>();
  private activeRaid:
    | {
        targetSmallID: number;
        targetName: string;
        startTick: number;
        startTiles: number;
        targetGain: number;
        committedTroops: number;
        targetTroopsAtStart: number;
        targetTilesAtStart: number;
        minimumHoldTicks: number;
        deadlineTicks: number;
        maximumGambleTicks: number;
        purpose: "denial" | "hostile raid";
        attackID?: string;
        gambleAnnounced?: boolean;
      }
    | undefined;
  private retaliationWatch:
    | { targetSmallID: number; untilTick: number }
    | undefined;
  private outcomeRecorded = false;
  private restartScheduled = false;
  private maxSpeedApplied = false;
  private appliedTrainingSpeed: ReplaySpeedMultiplier | undefined;
  private maxOpponentsSeen = 0;
  private readonly matchTelemetry: MatchTelemetry = {
    startedTick: -1,
    lastObservedTick: -1,
    startingTiles: 0,
    lastTiles: 0,
    lastGainTick: 0,
    peakTiles: 0,
    lowReserveTicks: 0,
    thirdPartyPressureTicks: 0,
    currentStallTicks: 0,
    longestStallTicks: 0,
    currentNoGrowthTicks: 0,
    longestNoGrowthTicks: 0,
    maxIncomingRatio: 0,
    maxCommittedRatio: 0,
    peakCities: 0,
    peakFactories: 0,
    peakDefensePosts: 0,
    decisionCycles: 0,
  };
  private lastDefenseObservation:
    | { tick: number; tiles: number; troops: number }
    | undefined;
  private defenseLossWindow: Array<{
    tick: number;
    elapsedTicks: number;
    tileLoss: number;
    troopLoss: number;
  }> = [];
  private lesson = 0;
  private busy = false;
  private enabled = true;
  private remotePaused = false;
  private nextTrainingControlTick = 0;
  private allowedTrainingChoices = new Set<TrainingChoice>([
    "land-attack",
    "expansion",
    "naval",
    "strategic",
    "diplomacy",
  ]);
  private brainReady = false;
  private brainStorage = "Restoring browser and server copies…";
  private remoteSaveTimer: number | undefined;
  private decision = "Restoring learned brain…";
  private detail =
    "The trainer will not act until the newest valid copy is loaded.";
  private readonly history: TrainerTrace[] = [];
  private strategicPlan: StrategicPlan | undefined;
  private lastPlanningMs = 0;
  private planningStage = "idle";
  private planningStageStartedAt = 0;
  private lastPlanningStageMs = 0;
  private lastTelemetryTick = -1;
  private lastGoldObservation: { tick: number; gold: number } | undefined;
  private estimatedIncomePerMinute = 0;
  private recentEconomicIncomeRates: number[] = [];
  private lastIncomeWindfallRatio = 0;
  private economicPlan: EconomicSystemPlan | undefined;
  private moduleCoordination: AiModuleCoordination | undefined;
  private moduleSignals: AiModuleSignals = {};
  private landCapacityProjection: LandCapacityProjection | undefined;
  private nextEconomicCostRefreshTick = 0;
  private economicCostCache:
    | {
        city: number;
        factory: number;
        port: number;
        defensePost: number;
        silo: number;
        sam: number;
        atomBomb: number;
        hydrogenBomb: number;
      }
    | undefined;
  private readonly opponentSnapshots = new Map<string, OpponentObservation>();
  private readonly opponentForecasts = new Map<string, OpponentForecast>();
  private cachedOpponentModels: OpponentModel[] = [];
  private lastOpponentForecastTick = Number.NEGATIVE_INFINITY;
  private opponentForecastSamples = 0;
  private opponentForecastCorrect = 0;
  private remnantTargetsSeen = 0;
  private readonly pendingPredictions: ActionHistoryEntry[] = [];
  private predictionSamples = 0;
  private readonly handlePageHide = () => {
    window.clearTimeout(this.remoteSaveTimer);
    void this.persistLearning(true);
  };

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {
    this.overlay.onPauseChange = (paused) => {
      this.enabled = !paused;
      this.setDecision(
        paused ? "Teaching paused" : "Teaching resumed",
        paused
          ? "The match keeps running, but the trainer will not issue actions."
          : "The trainer is evaluating the next legal action.",
      );
    };
    document.body.append(this.overlay);
    window.addEventListener("pagehide", this.handlePageHide);
    void this.restoreLearning();
  }

  tick(): void {
    const player = this.game.myPlayer();
    this.settleActionPredictions(player);
    this.refreshTrainingControl();
    this.render(player);
    if (!this.brainReady) return;
    if (this.game.inSpawnPhase()) {
      this.tryChooseTrainingSpawn(player);
      return;
    }
    if (player !== null && !player.isAlive()) {
      this.handleTrainingDeath(player);
      return;
    }
    if (player !== null) this.observeMatch(player);
    if (player !== null) this.handleIncomingAllianceRequests(player);
    if (player !== null) this.observeAllianceCooperation(player);
    this.applyMaxSpeedAfterFirstFrame();
    this.updateTrainingSpeed();
    if (this.actionsEnabled()) this.monitorTransportRisk(player);
    if (this.actionsEnabled()) this.monitorLandRaid(player);
    if (this.actionsEnabled()) this.monitorRetaliation(player);
    this.followActiveTransport(player);
    const currentTick = this.game.ticks();
    if (
      !this.actionsEnabled() ||
      this.busy ||
      this.game.inSpawnPhase() ||
      player === null ||
      !player.isAlive()
    ) {
      return;
    }
    const maxTroops = Math.max(1, this.game.config().maxTroops(player));
    const tribesAlive = this.game
      .players()
      .filter(
        (candidate) =>
          candidate.isAlive() && candidate.type() === PlayerType.Bot,
      ).length;
    const currentObservation: AdaptivePlanningObservation = {
      incomingFronts: player
        .incomingAttacks()
        .filter((attack) => !attack.retreating).length,
      outgoingFronts: player
        .outgoingAttacks()
        .filter((attack) => !attack.retreating).length,
      tribesAlive,
      reserveRatio: player.troops() / maxTroops,
      tiles: player.numTilesOwned(),
      strategicStructures: player.units(...STRATEGIC_LAND_STRUCTURE_TYPES)
        .length,
    };
    const targetReserveRatio =
      currentObservation.incomingFronts > 0
        ? 0.55
        : currentObservation.outgoingFronts > 0
          ? 0.66
          : tribesAlive > 0
            ? 0.66
            : 0.82;
    const ticksUntilUsefulReserve = estimateTicksUntilReserve({
      troops: player.troops(),
      maxTroops,
      troopIncreasePerTick: this.game.config().troopIncreaseRate(player),
      targetRatio: targetReserveRatio,
    });
    const cadence = planAdaptivePlanningCadence({
      tick: currentTick,
      lastPlanningTick: this.lastPlanningTick,
      nextPlanningTick: this.nextDecisionTick,
      current: currentObservation,
      previous: this.lastPlanningObservation,
      ticksUntilUsefulReserve,
    });
    this.lastPlanningObservation = currentObservation;
    this.adaptivePlanningMode = cadence.mode;
    this.adaptivePlanningIntervalTicks = cadence.intervalTicks;
    this.adaptivePlanningForecastHorizonTicks = cadence.forecastHorizonTicks;
    this.forceOpponentForecastRefresh ||= cadence.refreshOpponentForecasts;
    this.predictedReadyTick =
      ticksUntilUsefulReserve > 0
        ? currentTick + ticksUntilUsefulReserve
        : currentTick;
    if (!cadence.run) {
      this.adaptivePlanningPassesSkipped++;
      return;
    }

    this.lastPlanningTick = currentTick;
    this.nextDecisionTick = currentTick + cadence.intervalTicks;
    this.adaptivePlanningPassesExecuted++;
    this.matchTelemetry.decisionCycles++;
    this.busy = true;
    const planningStarted = performance.now();
    this.setPlanningStage(`${cadence.mode}:${cadence.reason}`);
    void this.decide(player).finally(() => {
      this.lastPlanningMs = performance.now() - planningStarted;
      this.lastPlanningStageMs =
        performance.now() - this.planningStageStartedAt;
      this.busy = false;
    });
  }

  private actionsEnabled(): boolean {
    return this.enabled && !this.remotePaused;
  }

  private choiceAllowed(choice: TrainingChoice): boolean {
    return this.allowedTrainingChoices.has(choice);
  }

  private refreshTrainingControl(): void {
    const tick = this.game.ticks();
    if (tick < this.nextTrainingControlTick) return;
    this.nextTrainingControlTick = tick + 50;
    void fetch("/api/ai-training/control")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((payload: unknown) => {
        const control = (payload as { control?: unknown } | undefined)?.control;
        if (typeof control !== "object" || control === null) return;
        const candidate = control as {
          paused?: unknown;
          allowedChoices?: unknown;
        };
        if (
          typeof candidate.paused !== "boolean" ||
          !Array.isArray(candidate.allowedChoices)
        ) {
          return;
        }
        this.remotePaused = candidate.paused;
        this.allowedTrainingChoices = new Set(
          candidate.allowedChoices.filter(
            (choice): choice is TrainingChoice =>
              choice === "land-attack" ||
              choice === "expansion" ||
              choice === "naval" ||
              choice === "strategic" ||
              choice === "diplomacy",
          ),
        );
      })
      .catch(() => undefined);
  }

  private setPlanningStage(stage: string): void {
    this.planningStage = stage;
    this.planningStageStartedAt = performance.now();
  }

  stop(): void {
    window.removeEventListener("pagehide", this.handlePageHide);
    window.clearTimeout(this.remoteSaveTimer);
    void this.persistLearning(true);
    this.overlay.remove();
  }

  private mutationOutcomeScore(
    finishingRank: number,
    won: boolean,
    alive: boolean,
  ): number {
    const telemetry = this.matchTelemetry;
    const elapsedTicks = Math.max(1, this.game.ticks() - telemetry.startedTick);
    return scoreMutationOutcome({
      won,
      alive,
      playerCount: this.game.players().length,
      finishingRank,
      raidSuccessRate: this.raidSuccessRate(),
      retaliationRate: this.retaliationRate(),
      transportLossRate: this.transportLossRate(),
      predictionQuality: this.predictionQuality(),
      startingTiles: telemetry.startingTiles,
      peakTiles: telemetry.peakTiles,
      totalLandTiles: this.game.numLandTiles(),
      elapsedTicks,
      noGrowthTicks: Math.max(0, this.game.ticks() - telemetry.lastGainTick),
      longestNoGrowthTicks: telemetry.longestNoGrowthTicks,
      peakCities: telemetry.peakCities,
      peakFactories: telemetry.peakFactories,
    });
  }

  onGameEnd(update: WinUpdate): void {
    if (this.outcomeRecorded) return;
    this.outcomeRecorded = true;
    const player = this.game.myPlayer();
    const clientID = player?.clientID();
    if (player === null || clientID === null || clientID === undefined) return;
    this.settleActionPredictions(player);

    this.learning.matches++;
    const won = update.winner?.includes(clientID) === true;
    if (won) this.learning.wins++;
    this.learning.recentMatchResults.push(won ? "win" : "loss");
    this.learning.recentMatchResults =
      this.learning.recentMatchResults.slice(-20);
    if (!player.isAlive()) this.learning.eliminations++;
    const finishingRank =
      1 +
      this.game
        .players()
        .filter(
          (candidate) => candidate.numTilesOwned() > player.numTilesOwned(),
        ).length;
    this.learning.finishingRankTotal += finishingRank;
    const stats = update.allPlayersStats[clientID];
    this.learning.transportArrivals += Number(
      stats?.boats?.trans?.[BOAT_INDEX_ARRIVE] ?? 0n,
    );
    this.learning.transportDestroyed += Number(
      stats?.boats?.trans?.[BOAT_INDEX_DESTROY] ?? 0n,
    );
    const mutationScore = this.mutationOutcomeScore(
      finishingRank,
      won,
      player.isAlive(),
    );
    this.evaluateMutation(mutationScore);
    this.decayOldLearning();
    this.saveLearning();
    if (player.isAlive()) {
      this.restartScheduled = true;
      this.enabled = false;
      const completedSeeds =
        this.learning.candidateActive === 1
          ? this.learning.candidateSeedMatches
          : MUTATION_SEED_COHORT_SIZE;
      this.setDecision(
        "Seed match complete — rotating",
        `This policy has completed ${completedSeeds}/${MUTATION_SEED_COHORT_SIZE} independently seeded evaluations. The next seed starts automatically at MAX speed.`,
      );
      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent("restart-ai-training"));
      }, 1_000);
    }
  }

  private handleTrainingDeath(player: PlayerView): void {
    if (this.restartScheduled) return;
    this.restartScheduled = true;
    this.enabled = false;
    let finishingRank: number | null = null;
    let lossDiagnosis = "No dominant causal signal was recorded.";
    if (!this.outcomeRecorded) {
      this.outcomeRecorded = true;
      this.settleActionPredictions(player);
      finishingRank =
        1 +
        this.game
          .players()
          .filter(
            (candidate) => candidate.numTilesOwned() > player.numTilesOwned(),
          ).length;
      this.learning.matches++;
      this.learning.eliminations++;
      this.learning.recentMatchResults.push("loss");
      this.learning.recentMatchResults =
        this.learning.recentMatchResults.slice(-20);
      this.learning.finishingRankTotal += finishingRank;
      lossDiagnosis = this.recordLossDiagnosis(player);
      const mutationScore = this.mutationOutcomeScore(
        finishingRank,
        false,
        false,
      );
      this.evaluateMutation(mutationScore);
      this.decayOldLearning();
      this.saveLearning();
    }
    const completedSeeds =
      this.learning.candidateActive === 1
        ? this.learning.candidateSeedMatches
        : MUTATION_SEED_COHORT_SIZE;
    this.setDecision(
      this.learning.candidateActive === 1
        ? "Seed match failed — rotating"
        : "Seed cohort complete — mutating",
      `Death at rank ${finishingRank ?? "unknown"}. ${lossDiagnosis} This policy has completed ${completedSeeds}/${MUTATION_SEED_COHORT_SIZE} independently seeded evaluations; the next seed starts automatically at MAX speed.`,
    );
    window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent("restart-ai-training"));
    }, 1_000);
  }

  private recordLossDiagnosis(player: PlayerView): string {
    const telemetry = this.matchTelemetry;
    const elapsed = Math.max(1, this.game.ticks() - telemetry.startedTick);
    const noGainTicks = Math.max(0, this.game.ticks() - telemetry.lastGainTick);
    const cause = classifyLossCause({
      elapsedTicks: elapsed,
      thirdPartyPressureTicks: telemetry.thirdPartyPressureTicks,
      maxIncomingRatio: telemetry.maxIncomingRatio,
      lowReserveTicks: telemetry.lowReserveTicks,
      maxCommittedRatio: telemetry.maxCommittedRatio,
      longestStallTicks: telemetry.longestStallTicks,
      longestNoGrowthTicks: telemetry.longestNoGrowthTicks,
      noGainTicks,
      peakTiles: telemetry.peakTiles,
      peakCities: telemetry.peakCities,
    });

    this.learning.lastLossCause = cause;
    switch (cause) {
      case LossCause.Overextension:
        this.learning.lossOverextension++;
        break;
      case LossCause.ThirdParty:
        this.learning.lossThirdParty++;
        break;
      case LossCause.StalledOffense:
        this.learning.lossStalledOffense++;
        break;
      case LossCause.Containment:
        this.learning.lossContainment++;
        break;
      case LossCause.Infrastructure:
        this.learning.lossInfrastructure++;
        break;
      case LossCause.Unknown:
        break;
    }

    const killerID = player.killedBy();
    const killer =
      killerID === null ? null : this.game.playerByClientID(killerID);
    return `${this.lossCauseLabel(cause)}${killer === null ? "" : ` ending in elimination by ${killer.name()}`}: reserve stayed below 28% for ${telemetry.lowReserveTicks}/${elapsed} ticks, peak commitment was ${Math.round(telemetry.maxCommittedRatio * 100)}%, third-party pressure lasted ${telemetry.thirdPartyPressureTicks} ticks, the longest stalled attack lasted ${telemetry.longestStallTicks} ticks, and no land was gained for the final ${noGainTicks} ticks. Infrastructure peaked at ${telemetry.peakCities} cities and ${telemetry.peakDefensePosts} posts across ${telemetry.peakTiles.toLocaleString()} tiles.`;
  }

  private lossCauseLabel(cause = this.learning.lastLossCause): string {
    switch (cause) {
      case LossCause.Overextension:
        return "Overextension depleted the defensive reserve";
      case LossCause.ThirdParty:
        return "A third party exploited an open front";
      case LossCause.StalledOffense:
        return "A slow offensive trapped too many troops";
      case LossCause.Containment:
        return "Containment stopped territorial growth";
      case LossCause.Infrastructure:
        return "Insufficient infrastructure limited recovery";
      case LossCause.Unknown:
      default:
        return "No single loss cause dominates yet";
    }
  }

  private applyMaxSpeedAfterFirstFrame(): void {
    if (this.maxSpeedApplied) return;
    this.maxSpeedApplied = true;
    requestAnimationFrame(() => {
      if (!this.overlay.isConnected || this.restartScheduled) return;
      this.setTrainingSpeed(this.learningSpeedTarget());
      this.setDecision(
        this.appliedTrainingSpeed === ReplaySpeedMultiplier.fastest
          ? "Evolution running at MAX speed"
          : "Evolution running in thinking mode",
        this.appliedTrainingSpeed === ReplaySpeedMultiplier.fastest
          ? "The learned prediction brain is mature enough to run at MAX speed."
          : "The brain is still learning; the slower simulation gives planning and prediction enough time to evaluate each action.",
      );
    });
  }

  private learningSpeedTarget(): ReplaySpeedMultiplier {
    const predictionCount = this.learning.predictionCount;
    const quality = this.predictionQuality();
    if (
      this.learning.candidateActive === 0 &&
      predictionCount >= 96 &&
      quality >= 0.35
    ) {
      return ReplaySpeedMultiplier.fastest;
    }
    if (predictionCount >= 32 && quality >= 0.15) {
      return ReplaySpeedMultiplier.normal;
    }
    return ReplaySpeedMultiplier.slow;
  }

  private setTrainingSpeed(speed: ReplaySpeedMultiplier): void {
    if (this.appliedTrainingSpeed === speed) return;
    this.appliedTrainingSpeed = speed;
    this.eventBus.emit(new ReplaySpeedChangeEvent(speed));
  }

  private updateTrainingSpeed(): void {
    if (!this.maxSpeedApplied || this.restartScheduled) return;
    const target = this.learningSpeedTarget();
    if (target === this.appliedTrainingSpeed) return;
    this.setTrainingSpeed(target);
    this.setDecision(
      target === ReplaySpeedMultiplier.fastest
        ? "Prediction brain graduated to MAX speed"
        : target === ReplaySpeedMultiplier.normal
          ? "Prediction confidence earned normal speed"
          : "Prediction confidence reset to thinking mode",
      `The trainer has ${this.learning.predictionCount} portable predictions at ${Math.round(this.predictionQuality() * 100)}% quality. Speed is now ${target === ReplaySpeedMultiplier.fastest ? "MAX" : target === ReplaySpeedMultiplier.normal ? "normal" : "slow"} so computation matches confidence.`,
    );
  }

  private tryChooseTrainingSpawn(player: PlayerView | null): void {
    if (
      player?.state.spawnTile !== undefined ||
      this.game.config().isRandomSpawn() ||
      this.game.ticks() - this.lastSpawnRequestTick < 8
    ) {
      return;
    }

    const spawned = this.game
      .players()
      .map((candidate) => ({
        player: candidate,
        tile: candidate.state.spawnTile,
      }))
      .filter(
        (candidate): candidate is { player: PlayerView; tile: number } =>
          candidate.tile !== undefined,
      );
    const nations = spawned.filter(
      ({ player: candidate }) => candidate.type() === PlayerType.Nation,
    );
    const allTribes = spawned.filter(
      ({ player: candidate }) => candidate.type() === PlayerType.Bot,
    );
    const tribes = allTribes
      .map((tribe) => ({
        ...tribe,
        nearbyTribes: allTribes.filter(
          (other) =>
            Math.hypot(
              this.game.x(tribe.tile) - this.game.x(other.tile),
              this.game.y(tribe.tile) - this.game.y(other.tile),
            ) <= 55,
        ).length,
        nationClearance: Math.min(
          ...nations.map((nation) =>
            Math.hypot(
              this.game.x(tribe.tile) - this.game.x(nation.tile),
              this.game.y(tribe.tile) - this.game.y(nation.tile),
            ),
          ),
          120,
        ),
      }))
      .sort(
        (a, b) =>
          b.nearbyTribes * 18 +
          b.nationClearance -
          (a.nearbyTribes * 18 + a.nationClearance),
      )
      .slice(0, 48);
    if (tribes.length === 0) return;

    let best:
      | {
          tile: number;
          tribe: PlayerView;
          tribeDistance: number;
          nationDistance: number;
          nearbyTribes: number;
          neutralSpace: number;
          coastDistance: number | null;
          openWaterDirections: number;
          score: number;
        }
      | undefined;
    const radii = [10, 13, 16, 20];
    const angles = 12;
    for (const tribe of tribes) {
      const tribeX = this.game.x(tribe.tile);
      const tribeY = this.game.y(tribe.tile);
      for (const radius of radii) {
        for (let angleIndex = 0; angleIndex < angles; angleIndex++) {
          const angle = (angleIndex / angles) * Math.PI * 2;
          const x = Math.round(tribeX + Math.cos(angle) * radius);
          const y = Math.round(tribeY + Math.sin(angle) * radius);
          if (!this.game.isValidCoord(x, y)) continue;
          const tile = this.game.ref(x, y);
          if (
            this.attemptedSpawnTiles.has(tile) ||
            !this.game.isLand(tile) ||
            this.game.isImpassable(tile) ||
            this.game.hasOwner(tile)
          ) {
            continue;
          }
          const spawnSpace = this.game.circleSearch(
            tile,
            4,
            (nearby) =>
              this.game.isLand(nearby) &&
              !this.game.isImpassable(nearby) &&
              !this.game.hasOwner(nearby),
          ).size;
          if (spawnSpace < 24) continue;
          const neutralSpace = this.game.circleSearch(
            tile,
            16,
            (nearby) =>
              this.game.isLand(nearby) &&
              !this.game.isImpassable(nearby) &&
              !this.game.hasOwner(nearby),
          ).size;
          const nationDistance = Math.min(
            ...nations.map((nation) =>
              Math.hypot(
                this.game.x(tile) - this.game.x(nation.tile),
                this.game.y(tile) - this.game.y(nation.tile),
              ),
            ),
            120,
          );
          const nearbyTribes = allTribes.filter(
            (other) =>
              Math.hypot(
                this.game.x(tile) - this.game.x(other.tile),
                this.game.y(tile) - this.game.y(other.tile),
              ) <= 55,
          ).length;
          const coastalAccess = sampleCoastalAccess({
            originX: x,
            originY: y,
            isValidCoord: (coastX, coastY) =>
              this.game.isValidCoord(coastX, coastY),
            tileAt: (coastX, coastY) => this.game.ref(coastX, coastY),
            isOceanShore: (coastTile) => this.game.isOceanShore(coastTile),
            openWaterDirections: (coastTile) =>
              this.game
                .neighbors(coastTile)
                .filter((neighbor) => this.game.isWater(neighbor)).length,
          });
          const score = scoreTrainingSpawn({
            neutralSpace,
            nearbyTribes,
            nationDistance,
            tribeDistance: radius,
            tribeTroops: tribe.player.troops(),
            coastDistance: coastalAccess.distance,
            openWaterDirections: coastalAccess.openWaterDirections,
          });
          if (best === undefined || score > best.score) {
            best = {
              tile,
              tribe: tribe.player,
              tribeDistance: radius,
              nationDistance,
              nearbyTribes,
              neutralSpace,
              coastDistance: coastalAccess.distance,
              openWaterDirections: coastalAccess.openWaterDirections,
              score,
            };
          }
        }
      }
    }
    if (best === undefined) return;

    this.attemptedSpawnTiles.add(best.tile);
    this.lastSpawnRequestTick = this.game.ticks();
    this.eventBus.emit(new SendSpawnIntentEvent(best.tile));
    this.follow(best.tribe, 8);
    this.setDecision(
      `Spawn beside ${best.tribe.name()}`,
      `Selected a cluster with ${best.nearbyTribes} tribes inside the opening region, ${best.neutralSpace} nearby neutral tiles, and ${Math.round(best.nationDistance)} tiles to the nearest nation. The first tribe is only ${Math.round(best.tribeDistance)} tiles away${best.coastDistance === null ? "; no useful ocean coast was found inside the bounded scan" : `, while open ocean coast is about ${Math.round(best.coastDistance)} tiles away with ${best.openWaterDirections} water exits for early ports and piracy`}.`,
    );
  }

  private render(player: PlayerView | null): void {
    const players = this.game
      .players()
      .filter((candidate) => candidate.isAlive());
    const opponentsAlive = players.filter(
      (candidate) => candidate !== player,
    ).length;
    this.maxOpponentsSeen = Math.max(this.maxOpponentsSeen, opponentsAlive);
    const totalTiles = players.reduce(
      (sum, candidate) => sum + candidate.numTilesOwned(),
      0,
    );
    const transports = player?.units(UnitType.TransportShip) ?? [];
    const incoming =
      player?.incomingAttacks().filter((attack) => !attack.retreating) ?? [];
    const outgoing = player?.outgoingAttacks() ?? [];
    this.overlay.updateSnapshot({
      tick: this.game.ticks(),
      status: this.restartScheduled
        ? "restarting"
        : !this.brainReady
          ? "loading"
          : this.game.inSpawnPhase()
            ? "spawning"
            : !this.enabled
              ? "paused"
              : this.busy
                ? "thinking"
                : "running",
      decision: this.decision,
      detail: this.detail,
      troops: player?.troops() ?? 0,
      maxTroops: player === null ? 0 : this.game.config().maxTroops(player),
      gold: Number(player?.gold() ?? 0n),
      tiles: player?.numTilesOwned() ?? 0,
      territoryShare:
        player === null || totalTiles === 0
          ? 0
          : player.numTilesOwned() / totalTiles,
      lesson: this.lesson,
      transportShips: transports.length,
      warships: player?.units(UnitType.Warship).length ?? 0,
      fleetTroops: transports.reduce(
        (sum, transport) => sum + transport.troops(),
        0,
      ),
      incomingFronts: incoming.length,
      incomingTroops: incoming.reduce((sum, attack) => sum + attack.troops, 0),
      outgoingFronts: outgoing.length,
      nationsAlive: players.filter(
        (candidate) => candidate.type() === PlayerType.Nation,
      ).length,
      tribesAlive: players.filter(
        (candidate) => candidate.type() === PlayerType.Bot,
      ).length,
      humansAlive: players.filter(
        (candidate) => candidate.type() === PlayerType.Human,
      ).length,
      opponentsAlive,
      totalOpponents: this.maxOpponentsSeen,
      learnedMatches: this.learning.matches,
      mutationGeneration: this.learning.mutationGeneration,
      aggressionGene: this.activeGene("Aggression"),
      cautionGene: this.activeGene("Caution"),
      navalGene: this.activeGene("Naval"),
      candidateBaselineScore: this.learning.candidateBaselineScore,
      bestMutationScore: this.learning.bestMutationScore,
      candidateSeedMatches: this.learning.candidateSeedMatches ?? 0,
      candidateSeedTarget: MUTATION_SEED_COHORT_SIZE,
      raidSuccessRate: this.raidSuccessRate(),
      retaliationRate: this.retaliationRate(),
      transportLossRate: this.transportLossRate(),
      brainStorage: this.brainStorage,
      brainRevision: this.learning.saveRevision,
      lastLossCause: this.lossCauseLabel(),
      history: this.history,
    });
    this.publishTelemetry(player, incoming.length, outgoing.length);
  }

  private analyzeEconomicConnections(player: PlayerView) {
    const cities = player.units(UnitType.City);
    const factories = player.units(UnitType.Factory);
    const ports = player.units(UnitType.Port);
    const defensePosts = player.units(UnitType.DefensePost);
    const economicStructures = [...cities, ...factories, ...ports];
    const strategicStructures = player.units(...STRATEGIC_LAND_STRUCTURE_TYPES);
    const cityStackRadiusSquared =
      (this.game.config().structureMinDist() * 2.25) ** 2;
    const cityNeighbors = cities.map((city, index) =>
      cities
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(
          ({ candidate, candidateIndex }) =>
            candidateIndex !== index &&
            this.game.euclideanDistSquared(city.tile(), candidate.tile()) <=
              cityStackRadiusSquared,
        )
        .map(({ candidateIndex }) => candidateIndex),
    );
    const stackedCities = cityNeighbors.filter(
      (neighbors) => neighbors.length > 0,
    ).length;
    const visitedCities = new Set<number>();
    let largestCityStack = 0;
    for (let index = 0; index < cities.length; index++) {
      if (visitedCities.has(index)) continue;
      const pending = [index];
      visitedCities.add(index);
      let clusterSize = 0;
      while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined) break;
        clusterSize++;
        for (const neighbor of cityNeighbors[current]) {
          if (visitedCities.has(neighbor)) continue;
          visitedCities.add(neighbor);
          pending.push(neighbor);
        }
      }
      largestCityStack = Math.max(largestCityStack, clusterSize);
    }

    const stationMinimumRange = this.game.config().trainStationMinRange();
    const stationMaximumRange = this.game.config().trainStationMaxRange();
    const stationMinimumRangeSquared = stationMinimumRange ** 2;
    const factoryConnectedPorts = ports.filter(
      (port) =>
        port.hasTrainStation() &&
        factories.some((factory) => {
          return isWithinRailConnectionRange({
            distanceSquared: this.game.euclideanDistSquared(
              port.tile(),
              factory.tile(),
            ),
            minimumRange: stationMinimumRange,
            maximumRange: stationMaximumRange,
          });
        }),
    ).length;
    const factoryStopCounts = factories.map(
      (factory) =>
        this.game
          .nearbyUnits(
            factory.tile(),
            this.game.config().trainStationMaxRange(),
            [UnitType.City, UnitType.Port],
            ({ unit }) => {
              const owner = unit.owner() as PlayerView;
              return (
                owner === player ||
                (owner.isAlive() &&
                  !player.hasEmbargo(owner) &&
                  !owner.hasEmbargo(player))
              );
            },
          )
          .filter(
            ({ distSquared }) => distSquared >= stationMinimumRangeSquared,
          ).length,
    );
    const externalPortOwners = [
      ...new Set(
        this.game
          .units(UnitType.Port)
          .map((port) => port.owner() as PlayerView)
          .filter((candidate) => candidate !== player && candidate.isAlive()),
      ),
    ];
    const tradePartners = externalPortOwners.filter(
      (candidate) =>
        !player.hasEmbargo(candidate) && !candidate.hasEmbargo(player),
    ).length;
    const embargoedPartners = externalPortOwners.length - tradePartners;
    const defenseRangeSquared = this.game.config().defensePostRange() ** 2;
    const exposedEconomicStructures = economicStructures.filter(
      (structure) =>
        !defensePosts.some(
          (post) =>
            this.game.euclideanDistSquared(structure.tile(), post.tile()) <=
            defenseRangeSquared,
        ),
    ).length;
    const railStops = [...cities, ...ports];

    return {
      cities: cities.length,
      stackedCities,
      largestCityStack,
      factories: factories.length,
      factoryProductiveStops: factoryStopCounts.reduce(
        (sum, count) => sum + count,
        0,
      ),
      isolatedFactories: factoryStopCounts.filter((count) => count < 2).length,
      ports: ports.length,
      factoryConnectedPorts,
      unconnectedPorts: Math.max(0, ports.length - factoryConnectedPorts),
      tradePartners,
      embargoedPartners,
      railStops: railStops.length,
      connectedRailStops: railStops.filter((unit) => unit.hasTrainStation())
        .length,
      defensePosts: defensePosts.length,
      strategicStructures: strategicStructures.length,
      exposedEconomicStructures,
    };
  }

  private observeEconomicIncome(player: PlayerView, tick: number): void {
    const gold = Number(player.gold());
    const previous = this.lastGoldObservation;
    this.lastGoldObservation = { tick, gold };
    if (previous === undefined || tick <= previous.tick) return;

    const elapsedTicks = tick - previous.tick;
    const decay = Math.exp(-elapsedTicks / 1_200);
    this.estimatedIncomePerMinute *= decay;
    const gainedGold = gold - previous.gold;
    if (gainedGold <= 0) return;

    const ticksPerMinute = 60_000 / this.game.config().msPerTick();
    const observedRate = Math.min(
      100_000_000,
      (gainedGold * ticksPerMinute) / elapsedTicks,
    );
    const update = updateRecurringIncomeEstimate({
      currentEstimate: this.estimatedIncomePerMinute,
      observedRate,
      recentAcceptedRates: this.recentEconomicIncomeRates,
    });
    this.estimatedIncomePerMinute = update.estimate;
    this.lastIncomeWindfallRatio = update.windfallRatio;
    this.recentEconomicIncomeRates.push(update.acceptedRate);
    if (this.recentEconomicIncomeRates.length > 24) {
      this.recentEconomicIncomeRates.splice(
        0,
        this.recentEconomicIncomeRates.length - 24,
      );
    }
  }

  private async economicBuildCosts(player: PlayerView) {
    const tick = this.game.ticks();
    if (
      this.economicCostCache !== undefined &&
      tick < this.nextEconomicCostRefreshTick
    ) {
      return this.economicCostCache;
    }
    const buildables = await player.buildables(undefined, [
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
    ]);
    const cost = (type: UnitType): number =>
      Number(
        buildables.find((buildable) => buildable.type === type)?.cost ?? 0,
      );
    this.economicCostCache = {
      city: cost(UnitType.City),
      factory: cost(UnitType.Factory),
      port: cost(UnitType.Port),
      defensePost: cost(UnitType.DefensePost),
      silo: cost(UnitType.MissileSilo),
      sam: cost(UnitType.SAMLauncher),
      atomBomb: cost(UnitType.AtomBomb),
      hydrogenBomb: cost(UnitType.HydrogenBomb),
    };
    this.nextEconomicCostRefreshTick = tick + 25;
    return this.economicCostCache;
  }

  private publishTelemetry(
    player: PlayerView | null,
    incomingFronts: number,
    outgoingFronts: number,
  ): void {
    if (!this.brainReady || player === null || !player.isAlive()) return;
    const tick = this.game.ticks();
    if (!shouldPublishTelemetry(tick, this.lastTelemetryTick)) return;
    this.lastTelemetryTick = tick;
    const maxTroops = Math.max(1, this.game.config().maxTroops(player));
    const incomingAttacks = player.incomingAttacks();
    const outgoingAttacks = player.outgoingAttacks();
    const outgoingTargets = new Set(
      outgoingAttacks.map((attack) => attack.targetID),
    );
    const activeRaidAttack =
      this.activeRaid === undefined
        ? undefined
        : outgoingAttacks.find(
            (attack) => attack.targetID === this.activeRaid?.targetSmallID,
          );
    const economy = this.analyzeEconomicConnections(player);
    const highestForecast = [...this.opponentForecasts.values()].sort(
      (a, b) => b.threat - a.threat,
    )[0];
    const highestForecastPlayer =
      highestForecast === undefined
        ? undefined
        : this.game
            .players()
            .find((candidate) => candidate.id() === highestForecast.id);
    void fetch("/api/ai-training/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tick,
        decision: this.decision,
        detail: this.detail,
        decisionCycles: this.matchTelemetry.decisionCycles,
        planAction: this.strategicPlan?.action,
        planScore: this.strategicPlan?.score,
        reserveRatio: player.troops() / maxTroops,
        troops: player.troops(),
        maxTroops,
        tiles: player.numTilesOwned(),
        incomingFronts,
        incomingTroops: incomingAttacks.reduce(
          (sum, attack) => sum + attack.troops,
          0,
        ),
        thirdPartyIncomingTroops: incomingAttacks
          .filter((attack) => !outgoingTargets.has(attack.attackerID))
          .reduce((sum, attack) => sum + attack.troops, 0),
        outgoingFronts,
        activeRaidTarget: this.activeRaid?.targetName,
        activeRaidTroops: activeRaidAttack?.troops,
        cities: economy.cities,
        stackedCities: economy.stackedCities,
        largestCityStack: economy.largestCityStack,
        factories: economy.factories,
        factoryProductiveStops: economy.factoryProductiveStops,
        isolatedFactories: economy.isolatedFactories,
        factoryConnectedPorts: economy.factoryConnectedPorts,
        unconnectedPorts: economy.unconnectedPorts,
        economicAction: this.economicPlan?.action,
        economicScore: this.economicPlan?.score,
        economicGoldReserve: this.economicPlan?.goldReserveFloor,
        economicSpendableGold: this.economicPlan?.spendableGold,
        estimatedIncomePerMinute: this.estimatedIncomePerMinute,
        recurringIncomeWindfallRatio: this.lastIncomeWindfallRatio,
        exposedEconomicStructures: economy.exposedEconomicStructures,
        tradePartners: economy.tradePartners,
        embargoedPartners: economy.embargoedPartners,
        connectedRailStops: economy.connectedRailStops,
        railStops: economy.railStops,
        defensePosts: economy.defensePosts,
        strategicStructures: economy.strategicStructures,
        opponentsAlive: this.game
          .players()
          .filter((candidate) => candidate !== player && candidate.isAlive())
          .length,
        forecastedOpponents: this.opponentForecasts.size,
        opponentForecastAccuracy:
          this.opponentForecastSamples === 0
            ? 0
            : this.opponentForecastCorrect / this.opponentForecastSamples,
        highestForecastThreat: highestForecast?.threat,
        predictedEnemyChoice: highestForecast?.predictedChoice,
        predictedEnemyName: highestForecastPlayer?.name(),
        remnantTargets: this.remnantTargetsSeen,
        allianceAction: this.latestAllianceAction,
        allyReliability: this.latestAllyReliability,
        trustedAllies: this.latestTrustedAllies,
        coalitionTarget: this.latestCoalitionTarget,
        coalitionAvailableHelpers: this.latestCoalitionHelpers,
        coalitionTreatyBlockedHelpers: this.latestCoalitionTreatyBlocks,
        coalitionOffensiveCostMultiplier:
          this.latestCoalitionTargetCostMultiplier,
        coalitionGrowthDonations: this.coalitionGrowthDonations,
        coalitionGrowthRateGain: this.latestCoalitionGrowthGain,
        allyRequestsSent: [...this.allyCooperation.values()].reduce(
          (sum, record) => sum + record.requestsSent,
          0,
        ),
        allyRequestsAnswered: [...this.allyCooperation.values()].reduce(
          (sum, record) => sum + record.requestsAnswered,
          0,
        ),
        allyIgnoredRequests: [...this.allyCooperation.values()].reduce(
          (sum, record) => sum + record.ignoredRequests,
          0,
        ),
        strategicCollateralRejections: this.strategicCollateralRejections,
        strategicOwnSilos: this.strategicCapability
          ? player.units(UnitType.MissileSilo).length
          : undefined,
        strategicReadySlots: this.strategicCapability
          ? countReadySiloSlots(
              player.units(UnitType.MissileSilo).map((silo) => ({
                level: silo.level(),
                reloading: silo.missileTimerQueue().length,
              })),
            )
          : undefined,
        strategicCandidateCount: this.strategicCandidateCount,
        strategicLaunches: this.strategicLaunches,
        strategicSiloBuilds: this.strategicSiloBuilds,
        strategicRouteRejections: this.strategicRouteRejections,
        strategicStatus: this.lastStrategicStatus,
        strategicTarget: this.lastStrategicTarget,
        strategicWeapon: this.lastStrategicWeapon,
        strategicScore: this.lastStrategicScore,
        moduleConsensusAction: this.moduleCoordination?.consensusAction,
        modulePreferredInvestment: this.moduleCoordination?.preferredInvestment,
        shipyardConnectionPriority:
          this.moduleSignals.shipyardFactoryConnectionPriority,
        portAction: this.moduleSignals.portAction,
        portActionUrgency: this.moduleSignals.portActionUrgency,
        portBudgetCoverageRatio: this.moduleSignals.portBudgetCoverageRatio,
        portFleetCoverageRatio: this.moduleSignals.portFleetCoverageRatio,
        portRepairLoadRatio: this.moduleSignals.portRepairLoadRatio,
        portThreatRatio: this.moduleSignals.portThreatRatio,
        portTradeCoverageRatio: this.moduleSignals.portTradeCoverageRatio,
        landCapacityGain: this.landCapacityProjection?.capacityGain,
        landRegenerationMultiplier:
          this.landCapacityProjection?.regenerationMultiplier,
        predictionCount: this.learning.predictionCount,
        predictionError: this.learning.predictionError,
        mutationGeneration: this.learning.mutationGeneration,
        troopDisplayDivisor: 10,
        planningMs: this.lastPlanningMs,
        planningStage: this.planningStage,
        planningStageMs: this.lastPlanningStageMs,
        planningMode: this.adaptivePlanningMode,
        planningIntervalTicks: this.adaptivePlanningIntervalTicks,
        planningForecastHorizonTicks: this.adaptivePlanningForecastHorizonTicks,
        planningPassesSkipped: this.adaptivePlanningPassesSkipped,
        planningPassesExecuted: this.adaptivePlanningPassesExecuted,
        predictedReadyTick: this.predictedReadyTick,
        opponentForecastIntervalTicks: this.opponentForecastIntervalTicks,
      }),
    }).catch(() => undefined);
  }

  private observeMatch(player: PlayerView): void {
    const telemetry = this.matchTelemetry;
    const tick = this.game.ticks();
    this.observeEconomicIncome(player, tick);
    this.observeDefenseLoss(player, tick);
    if (telemetry.startedTick < 0) {
      telemetry.startedTick = tick;
      telemetry.lastObservedTick = tick;
      telemetry.startingTiles = player.numTilesOwned();
      telemetry.lastGainTick = tick;
      telemetry.lastTiles = player.numTilesOwned();
    }
    const observedTicks = Math.max(0, tick - telemetry.lastObservedTick);
    telemetry.lastObservedTick = tick;
    const maxTroops = Math.max(1, this.game.config().maxTroops(player));
    const reserveRatio = player.troops() / maxTroops;
    if (reserveRatio < 0.28) telemetry.lowReserveTicks += observedTicks;

    const outgoing = player
      .outgoingAttacks()
      .filter((attack) => !attack.retreating);
    const outgoingTroops = outgoing.reduce(
      (sum, attack) => sum + attack.troops,
      0,
    );
    telemetry.maxCommittedRatio = Math.max(
      telemetry.maxCommittedRatio,
      outgoingTroops / Math.max(1, outgoingTroops + player.troops()),
    );
    const incoming = player
      .incomingAttacks()
      .filter((attack) => !attack.retreating);
    const incomingTroops = incoming.reduce(
      (sum, attack) => sum + attack.troops,
      0,
    );
    telemetry.maxIncomingRatio = Math.max(
      telemetry.maxIncomingRatio,
      incomingTroops / Math.max(1, player.troops()),
    );
    const outgoingTargets = new Set(outgoing.map((attack) => attack.targetID));
    if (incoming.some((attack) => !outgoingTargets.has(attack.attackerID))) {
      telemetry.thirdPartyPressureTicks += observedTicks;
    }

    const tiles = player.numTilesOwned();
    if (tiles > telemetry.lastTiles) {
      telemetry.lastGainTick = tick;
      telemetry.currentNoGrowthTicks = 0;
      telemetry.currentStallTicks = 0;
    } else {
      telemetry.currentNoGrowthTicks += observedTicks;
      telemetry.longestNoGrowthTicks = Math.max(
        telemetry.longestNoGrowthTicks,
        telemetry.currentNoGrowthTicks,
      );
      if (outgoing.length > 0) {
        telemetry.currentStallTicks += observedTicks;
        telemetry.longestStallTicks = Math.max(
          telemetry.longestStallTicks,
          telemetry.currentStallTicks,
        );
      } else {
        telemetry.currentStallTicks = 0;
      }
    }
    telemetry.lastTiles = tiles;
    telemetry.peakTiles = Math.max(telemetry.peakTiles, tiles);
    telemetry.peakCities = Math.max(
      telemetry.peakCities,
      player.units(UnitType.City).length,
    );
    telemetry.peakFactories = Math.max(
      telemetry.peakFactories,
      player.units(UnitType.Factory).length,
    );
    telemetry.peakDefensePosts = Math.max(
      telemetry.peakDefensePosts,
      player.units(UnitType.DefensePost).length,
    );
  }

  private observeDefenseLoss(player: PlayerView, tick: number): void {
    const previous = this.lastDefenseObservation;
    const hasActiveIncoming = player
      .incomingAttacks()
      .some((attack) => !attack.retreating);
    if (previous !== undefined && tick > previous.tick) {
      if (hasActiveIncoming) {
        this.defenseLossWindow.push({
          tick,
          elapsedTicks: tick - previous.tick,
          tileLoss: Math.max(0, previous.tiles - player.numTilesOwned()),
          troopLoss: Math.max(0, previous.troops - player.troops()),
        });
      } else {
        this.defenseLossWindow = [];
      }
    }
    this.lastDefenseObservation = {
      tick,
      tiles: player.numTilesOwned(),
      troops: player.troops(),
    };
    const cutoffTick = tick - ATTACK_RETREAT_DELAY_TICKS;
    this.defenseLossWindow = this.defenseLossWindow.filter(
      (sample) => sample.tick >= cutoffTick,
    );
  }

  private observedDefenseLossRates(): {
    tileLossPerTick: number;
    troopLossPerTick: number;
  } {
    const elapsedTicks = this.defenseLossWindow.reduce(
      (sum, sample) => sum + sample.elapsedTicks,
      0,
    );
    if (elapsedTicks <= 0) {
      return { tileLossPerTick: 0, troopLossPerTick: 0 };
    }
    return {
      tileLossPerTick:
        this.defenseLossWindow.reduce(
          (sum, sample) => sum + sample.tileLoss,
          0,
        ) / elapsedTicks,
      troopLossPerTick:
        this.defenseLossWindow.reduce(
          (sum, sample) => sum + sample.troopLoss,
          0,
        ) / elapsedTicks,
    };
  }

  private async decide(player: PlayerView): Promise<void> {
    if (this.activeRaid !== undefined) return;

    this.setPlanningStage("front-analysis");
    const openingFrontLimit = player.numTilesOwned() < 2_000 ? 5 : 2;
    const borders = await player.borderTiles();
    let hasNeutralLand = false;
    let hasSeaAccess = false;
    const enemies = new Map<string, PlayerView>();
    const borderingPlayers = new Map<string, PlayerView>();
    const enemyTiles = new Map<string, number>();
    for (const border of borders.borderTiles) {
      if (this.game.isShore(border)) hasSeaAccess = true;
      for (const neighbor of this.game.neighbors(border)) {
        if (!this.game.isLand(neighbor)) continue;
        if (!this.game.hasOwner(neighbor)) {
          hasNeutralLand = true;
          continue;
        }
        const owner = this.game.owner(neighbor);
        if (owner.isPlayer() && owner !== player && owner.isAlive()) {
          borderingPlayers.set(owner.id(), owner);
          if (!player.isFriendly(owner)) {
            enemies.set(owner.id(), owner);
          }
        }
      }
    }
    const frontIntel = new Map<string, LandFrontIntel>();
    for (const enemy of enemies.values()) {
      const intel = this.analyzeLandFront(player, enemy, borders.borderTiles);
      if (intel === undefined) continue;
      frontIntel.set(enemy.id(), intel);
      enemyTiles.set(enemy.id(), intel.contactTile);
    }
    this.verifiedNationBorders = new Set(
      [...enemies.values()]
        .filter((candidate) => candidate.type() === PlayerType.Nation)
        .map((candidate) => candidate.id()),
    );

    const strategicStructures = player.units(...STRATEGIC_LAND_STRUCTURE_TYPES);
    const defenseRadius = this.game.config().defensePostRange();
    const incomingDefensePriority = new Map<string, number>();
    const incomingAttacks = player
      .incomingAttacks()
      .filter((attack) => !attack.retreating);
    for (const attack of incomingAttacks) {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      const contactTile =
        attacker.isPlayer() && attacker.type() !== PlayerType.Bot
          ? frontIntel.get(attacker.id())?.contactTile
          : undefined;
      incomingDefensePriority.set(
        attack.id,
        contactTile === undefined
          ? attack.troops
          : hostileFrontDefensePriority({
              troops: attack.troops,
              defenseRadius,
              structures: strategicStructures.map((structure) => ({
                distance: Math.sqrt(
                  this.game.euclideanDistSquared(contactTile, structure.tile()),
                ),
                type: structure.type(),
              })),
            }),
      );
    }
    incomingAttacks.sort(
      (a, b) =>
        (incomingDefensePriority.get(b.id) ?? b.troops) -
        (incomingDefensePriority.get(a.id) ?? a.troops),
    );
    const activeNationOffensiveIDs = new Set(
      player
        .outgoingAttacks()
        .map((attack) => this.game.playerBySmallID(attack.targetID))
        .filter((candidate) => candidate.isPlayer())
        .filter((candidate) => candidate.type() === PlayerType.Nation)
        .map((candidate) => candidate.id())
        .filter((id): id is string => id !== null),
    );
    for (const hostileID of this.hostileNationIDs) {
      const hostile = this.game
        .players()
        .find((candidate) => candidate.id() === hostileID);
      if (
        hostile === undefined ||
        !hostile.isAlive() ||
        player.isFriendly(hostile)
      ) {
        this.hostileNationIDs.delete(hostileID);
      }
    }
    const activeNationCombatIDs = new Set(
      [
        ...player.outgoingAttacks().map((attack) => attack.targetID),
        ...incomingAttacks.map((attack) => attack.attackerID),
      ]
        .map((smallID) => this.game.playerBySmallID(smallID))
        .filter((candidate) => candidate.isPlayer())
        .filter((candidate) => candidate.type() === PlayerType.Nation)
        .map((candidate) => candidate.id())
        .filter((id): id is string => id !== null),
    );
    const activeNationWarIDs = new Set([
      ...this.hostileNationIDs,
      ...activeNationCombatIDs,
    ]);
    const activeBorderNationWarIDs = new Set(
      [...activeNationWarIDs].filter(
        (id) =>
          this.verifiedNationBorders.has(id) || activeNationCombatIDs.has(id),
      ),
    );
    const frontPolicy = nationFrontPolicy({
      nationFronts: this.verifiedNationBorders.size,
      activeNationWars: activeBorderNationWarIDs.size,
    });

    // Terra Nullius has no defending army. Give adjacent free land first
    // refusal before forecasts, diplomacy, construction, naval planning, or
    // attacks on players. Existing and incoming fronts still protect their
    // reserve floors through the pure wilderness policy.
    this.setPlanningStage("wilderness-growth");
    const wildernessOutgoingAttacks = player
      .outgoingAttacks()
      .filter((attack) => !attack.retreating);
    const wildernessPlan = planWildernessExpansion({
      hasNeutralLand: hasNeutralLand && this.choiceAllowed("expansion"),
      reserveRatio:
        player.troops() / Math.max(1, this.game.config().maxTroops(player)),
      reserveFloor: frontPolicy.reserveFloor,
      incomingFronts: incomingAttacks.length,
      outgoingFronts: wildernessOutgoingAttacks.length,
      maximumFronts: openingFrontLimit,
      wildernessAttackActive: wildernessOutgoingAttacks.some(
        (attack) => attack.targetID === 0,
      ),
    });
    if (wildernessPlan.attack) {
      const wildernessTroops = Math.max(
        1,
        Math.floor(player.troops() * wildernessPlan.fraction),
      );
      this.eventBus.emit(new SendAttackIntentEvent(null, wildernessTroops));
      // The attack appears in player state asynchronously. Do not spend a
      // second action against the stale troop balance on this tick.
      this.nextDecisionTick = this.game.ticks() + 1;
      this.follow(player, 6);
      this.setDecision(
        "Expand into wilderness immediately",
        `${Math.round(wildernessPlan.fraction * 100)}% of current troops attack adjacent neutral land before any optional action. ${wildernessPlan.reason}; the projected home reserve remains ${Math.round(wildernessPlan.projectedReserveRatio * 100)}% of capacity.`,
      );
      return;
    }

    // A tribe that attacks us is answered before forecasting, construction, or
    // diplomacy. Counter only far enough to leave its invasion crawling under
    // the engine's live-troop speed formula; do not over-cancel into a wasteful
    // counter-invasion.
    const immediateTribeInvasion = incomingAttacks.find((attack) => {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      return attacker.isPlayer() && attacker.type() === PlayerType.Bot;
    });
    if (
      immediateTribeInvasion !== undefined &&
      this.choiceAllowed("land-attack")
    ) {
      const tribeAttacker = this.game.playerBySmallID(
        immediateTribeInvasion.attackerID,
      );
      if (tribeAttacker.isPlayer()) {
        const totalImmediateIncoming = incomingAttacks.reduce(
          (sum, attack) => sum + attack.troops,
          0,
        );
        const immediateReserveFloor = Math.max(
          frontPolicy.reserveFloor,
          Math.min(0.75, 0.4 + (incomingAttacks.length - 1) * 0.1),
        );
        const tribeCounter = defensiveCounterBudget({
          homeTroops: player.troops(),
          maxTroops: this.game.config().maxTroops(player),
          totalIncomingTroops: totalImmediateIncoming,
          selectedIncomingTroops: immediateTribeInvasion.troops,
          activeIncomingFronts: incomingAttacks.length,
          reserveFloorRatio: immediateReserveFloor,
        });
        if (
          shouldLaunchDefensiveCounter({
            homeTroops: player.troops(),
            selectedIncomingTroops: immediateTribeInvasion.troops,
            counterTroops: tribeCounter.counterTroops,
            currentRelativeCaptureSpeed:
              tribeCounter.currentRelativeCaptureSpeed,
            projectedRelativeCaptureSpeed:
              tribeCounter.projectedRelativeCaptureSpeed,
          })
        ) {
          this.nextDecisionTick = this.game.ticks() + 1;
          this.attack(
            player,
            tribeAttacker,
            Math.min(
              0.6,
              tribeCounter.counterTroops / Math.max(1, player.troops()),
            ),
            "Punish an attacking tribe immediately",
            `${renderTroops(tribeCounter.counterTroops)} troops cancel most of the tribe's ${renderTroops(immediateTribeInvasion.troops)} invasion immediately, leaving about ${renderTroops(tribeCounter.remainingIncomingTroops)}. That is ${(
              tribeCounter.projectedAttackerToDefenderRatio * 100
            ).toFixed(
              2,
            )}% of the surviving live home force and roughly ${Math.round(
              tribeCounter.projectedRelativeCaptureSpeed * 100,
            )}% of maximum capture speed, while ${renderTroops(tribeCounter.protectedTroops)} remain home.`,
          );
          return;
        }
      }
    }

    // A bordering tribe already attacked by somebody else is a perishable land
    // and gold opportunity. Join immediately instead of waiting for the normal
    // tick-40/full-bank tribe-growth trigger.
    this.setPlanningStage("contested-tribe");
    const activeUrgentTargets = new Set(
      player
        .outgoingAttacks()
        .filter((attack) => !attack.retreating)
        .map((attack) => attack.targetID),
    );
    const contestedTribe = [...enemies.values()]
      .filter((candidate) => candidate.type() === PlayerType.Bot)
      .filter((candidate) => !activeUrgentTargets.has(candidate.smallID()))
      .map((target) => {
        const outsideAttacks = target
          .incomingAttacks()
          .filter(
            (attack) =>
              !attack.retreating && attack.attackerID !== player.smallID(),
          );
        const outsideTroops = outsideAttacks.reduce(
          (sum, attack) => sum + attack.troops,
          0,
        );
        const front = frontIntel.get(target.id());
        const plan = planContestedTribeOpportunity({
          targetUnderAttack: outsideAttacks.length > 0,
          targetIncomingTroops: outsideTroops,
          ownTroops: player.troops(),
          maxTroops: this.game.config().maxTroops(player),
          reserveFloor: frontPolicy.reserveFloor,
          incomingFronts: incomingAttacks.length,
          outgoingFronts: activeUrgentTargets.size,
          maximumFronts: openingFrontLimit,
          alreadyAttackingTarget: activeUrgentTargets.has(target.smallID()),
          targetTroops: target.troops(),
          terrainLossCost: front?.averageLossCost ?? 1,
          wrapPotential: front?.wrapPotential ?? 0,
        });
        return { target, outsideTroops, front, plan };
      })
      .filter(({ plan }) => plan.attack)
      .sort(
        (a, b) =>
          b.plan.pressureRatio - a.plan.pressureRatio ||
          a.plan.effectiveTargetCost - b.plan.effectiveTargetCost,
      )[0];
    if (contestedTribe !== undefined && this.choiceAllowed("land-attack")) {
      this.nextDecisionTick = this.game.ticks() + 1;
      this.attack(
        player,
        contestedTribe.target,
        contestedTribe.plan.fraction,
        "Join the attack on a contested tribe",
        `${renderTroops(contestedTribe.outsideTroops)} third-party troops are already pressuring ${contestedTribe.target.name()}, equal to ${Math.round(
          contestedTribe.plan.pressureRatio * 100,
        )}% of its live force. The trainer commits ${Math.round(
          contestedTribe.plan.fraction * 100,
        )}% immediately through the ${contestedTribe.front?.terrainLabel ?? "mixed"} border while preserving a projected ${Math.round(
          contestedTribe.plan.projectedReserveRatio * 100,
        )}% home reserve; waiting would donate its land and captured gold to the other attacker.`,
      );
      return;
    }

    const noGrowthTicks = Math.max(
      0,
      this.game.ticks() - this.matchTelemetry.lastGainTick,
    );
    const terrainAdjustedAdvantageFor = (
      candidate: PlayerView,
      front: LandFrontIntel | undefined,
    ): number => {
      const isNation = candidate.type() === PlayerType.Nation;
      const requiredAdvantage = isNation
        ? Math.max(
            1.3,
            Math.min(
              1.8,
              1.55 -
                this.raidSuccessRate() * 0.18 +
                this.retaliationRate() * 0.15 +
                this.eliminationRate() * 0.1 -
                this.activeGene("Aggression") * 0.12 +
                this.activeGene("Caution") * 0.1,
            ),
          ) * frontPolicy.advantageMultiplier
        : 1.1;
      return requiredAdvantage * Math.min(2.5, front?.averageLossCost ?? 1);
    };
    const plannerMaxTroops = Math.max(1, this.game.config().maxTroops(player));
    const opponentPlayers = this.game
      .players()
      .filter((candidate) => candidate !== player && candidate.isAlive());
    this.opponentForecastIntervalTicks =
      this.adaptivePlanningMode === "reactive"
        ? OPPONENT_FORECAST_INTERVAL_TICKS
        : Math.max(
            OPPONENT_FORECAST_INTERVAL_TICKS,
            Math.min(
              20,
              Math.ceil(this.adaptivePlanningForecastHorizonTicks / 3),
            ),
          );
    const diplomacyStateChanged = opponentPlayers.some((candidate) => {
      const previous = this.opponentSnapshots.get(candidate.id());
      return (
        previous !== undefined &&
        previous.allied !== player.isFriendly(candidate)
      );
    });
    const shouldRefreshOpponentForecasts =
      this.forceOpponentForecastRefresh ||
      diplomacyStateChanged ||
      opponentPlayers.length !== this.opponentSnapshots.size ||
      this.game.ticks() - this.lastOpponentForecastTick >=
        this.opponentForecastIntervalTicks;
    if (shouldRefreshOpponentForecasts) {
      this.forceOpponentForecastRefresh = false;
      this.lastOpponentForecastTick = this.game.ticks();
      const opponentStates = opponentPlayers.map((candidate) => {
        const previous = this.opponentSnapshots.get(candidate.id());
        const incoming = candidate
          .incomingAttacks()
          .filter((attack) => !attack.retreating);
        const outgoing = candidate
          .outgoingAttacks()
          .filter((attack) => !attack.retreating);
        const strategicUnits = candidate.units(
          UnitType.City,
          UnitType.Factory,
          UnitType.Port,
          UnitType.MissileSilo,
          UnitType.Warship,
        );
        let cities = 0;
        let factories = 0;
        let ports = 0;
        let silos = 0;
        let warships = 0;
        for (const unit of strategicUnits) {
          switch (unit.type()) {
            case UnitType.City:
              cities++;
              break;
            case UnitType.Factory:
              factories++;
              break;
            case UnitType.Port:
              ports++;
              break;
            case UnitType.MissileSilo:
              silos++;
              break;
            case UnitType.Warship:
              warships++;
              break;
          }
        }
        const current: OpponentObservation = {
          tick: this.game.ticks(),
          tiles: candidate.numTilesOwned(),
          troops: candidate.troops(),
          maxTroops: Math.max(1, this.game.config().maxTroops(candidate)),
          gold: Number(candidate.gold()),
          incomingAttacks: incoming.length,
          incomingTroops: incoming.reduce(
            (sum, attack) => sum + attack.troops,
            0,
          ),
          outgoingAttacks: outgoing.length,
          outgoingTroops: outgoing.reduce(
            (sum, attack) => sum + attack.troops,
            0,
          ),
          cities,
          factories,
          ports,
          silos,
          warships,
          allied: player.isFriendly(candidate),
          sharesBorder: borderingPlayers.has(candidate.id()),
        };
        const previousForecast = this.opponentForecasts.get(candidate.id());
        const forecast = forecastOpponent({
          id: candidate.id(),
          current,
          previous,
          previousForecast,
          ownTroops: player.troops(),
          ownMaxTroops: plannerMaxTroops,
          ownTiles: player.numTilesOwned(),
        });
        if (previous !== undefined && previousForecast !== undefined) {
          this.opponentForecastSamples++;
          if (previousForecast.predictedChoice === forecast.observedChoice) {
            this.opponentForecastCorrect++;
          }
        }
        this.opponentSnapshots.set(candidate.id(), current);
        this.opponentForecasts.set(candidate.id(), forecast);
        return { candidate, current, previous, forecast };
      });
      const aliveOpponentIDs = new Set(
        opponentStates.map(({ candidate }) => candidate.id()),
      );
      for (const id of this.opponentSnapshots.keys()) {
        if (!aliveOpponentIDs.has(id)) {
          this.opponentSnapshots.delete(id);
          this.opponentForecasts.delete(id);
        }
      }
      this.cachedOpponentModels = opponentStates
        .filter(({ candidate }) => !player.isFriendly(candidate))
        .map(({ candidate, current, previous, forecast }) =>
          modelOpponent({
            id: candidate.id(),
            troops: current.troops,
            maxTroops: current.maxTroops,
            tiles: current.tiles,
            ownTiles: player.numTilesOwned(),
            incomingAttacks: current.incomingAttacks,
            outgoingAttacks: current.outgoingAttacks,
            silos: current.silos,
            warships: current.warships,
            previousTiles: previous?.tiles,
            previousTroops: previous?.troops,
            elapsedTicks: previous
              ? Math.max(1, current.tick - previous.tick)
              : 1,
            predictedChoice: forecast.predictedChoice,
            forecastThreat: forecast.threat,
          }),
        );
    }
    const opponentModels = this.cachedOpponentModels;
    const navalSituation = this.analyzeNavalSituation(
      player,
      borders.borderTiles,
    );
    const economicCosts = await this.economicBuildCosts(player);
    const ownSilos = player.units(UnitType.MissileSilo);
    const readyStrategicSlots = countReadySiloSlots(
      ownSilos
        .filter((silo) => silo.isActive() && !silo.isUnderConstruction())
        .map((silo) => ({
          level: silo.level(),
          reloading: silo.missileTimerQueue().length,
        })),
    );
    const strategicTargetPlayers = opponentPlayers.filter(
      (candidate) =>
        !player.isFriendly(candidate) &&
        candidate.type() !== PlayerType.Bot &&
        candidate.units(
          UnitType.City,
          UnitType.Factory,
          UnitType.Port,
          UnitType.MissileSilo,
          UnitType.SAMLauncher,
          UnitType.DefensePost,
        ).length > 0,
    );
    const enemyMissileSilos = opponentModels.reduce(
      (sum, model) => sum + model.siloCount,
      0,
    );
    const affordableStrategicWeapons = [
      economicCosts.atomBomb,
      economicCosts.hydrogenBomb,
    ].filter((cost) => cost > 0 && Number(player.gold()) >= cost).length;
    const totalIncomingTroops = incomingAttacks.reduce(
      (sum, attack) => sum + attack.troops,
      0,
    );
    this.strategicCapability = planStrategicCapability({
      ownSilos: ownSilos.length,
      readyLaunchSlots: readyStrategicSlots,
      affordableWeapons: affordableStrategicWeapons,
      actionableTargets: strategicTargetPlayers.length,
      enemySilos: enemyMissileSilos,
      highestThreat: Math.max(
        0,
        ...opponentModels.map((model) => model.forecastThreat ?? 0),
      ),
      reserveRatio: player.troops() / plannerMaxTroops,
      incomingPressureRatio: totalIncomingTroops / Math.max(1, player.troops()),
      activeNationWars: activeNationWarIDs.size,
      gold: Number(player.gold()),
      reserveGold: Math.max(250_000, this.estimatedIncomePerMinute * 1.5),
      siloCost: economicCosts.silo,
    });
    this.strategicPlan = planStrategicAction({
      reserveRatio: player.troops() / plannerMaxTroops,
      incomingFronts: incomingAttacks.length,
      incomingTroops: totalIncomingTroops,
      maxTroops: plannerMaxTroops,
      hasNeutralLand,
      hostileBorders: enemies.size,
      activeNationWars: activeNationWarIDs.size,
      navalThreats:
        navalSituation.hostileWarships.length +
        navalSituation.hostileTransports.length,
      tradeTargets: navalSituation.tradeTargets.length,
      navalPressureRatio: navalSituation.navalPressureRatio,
      tradeOpportunityRatio: navalSituation.tradeOpportunityRatio,
      siloTargets: opponentModels.reduce(
        (sum, model) => sum + model.siloCount,
        0,
      ),
      readyStrategicSlots,
      affordableStrategicWeapons,
      actionableStrikeTargets: strategicTargetPlayers.length,
      opponents: opponentModels,
    });
    const incoming = incomingAttacks[0];
    if (incoming !== undefined) {
      const totalIncoming = incomingAttacks.reduce(
        (sum, attack) => sum + attack.troops,
        0,
      );
      const incomingReserveRatio =
        player.troops() / Math.max(1, this.game.config().maxTroops(player));
      this.setPlanningStage("emergency-city");
      if (
        await this.tryBuildEmergencyCity(player, borders.borderTiles, {
          enemyFronts: enemies.size,
          activeWars: activeNationWarIDs.size,
          incomingFronts: incomingAttacks.length,
          reserveRatio: incomingReserveRatio,
          incomingTroops: totalIncoming,
          nationFronts: [...enemies.values()]
            .filter((enemy) => enemy.type() === PlayerType.Nation)
            .map((enemy) => ({
              contactTile: frontIntel.get(enemy.id())?.contactTile,
              troops: enemy.troops(),
              maxTroops: this.game.config().maxTroops(enemy),
            }))
            .filter(
              (
                front,
              ): front is {
                contactTile: number;
                troops: number;
                maxTroops: number;
              } => front.contactTile !== undefined,
            ),
        })
      ) {
        return;
      }
      this.setPlanningStage("defense");
      if (await this.tryBuildDefensePost(player, incomingAttacks, [], borders))
        return;
      if (
        incomingReserveRatio < 0.4 &&
        (await this.tryAlliance(
          player,
          enemies,
          enemyTiles,
          frontIntel,
          incomingReserveRatio,
          frontPolicy.desiredAlliances,
        ))
      ) {
        return;
      }
      this.setPlanningStage("alliance-coordination");
      if (
        await this.tryCoordinateWithAllies(
          player,
          frontPolicy.reserveFloor,
          activeNationWarIDs.size,
          borderingPlayers,
        )
      ) {
        return;
      }
      const attacker = this.game.playerBySmallID(incoming.attackerID);
      if (attacker.isPlayer()) {
        const {
          protectedTroops,
          counterTroops,
          remainingIncomingTroops,
          projectedAttackerToDefenderRatio,
          currentRelativeCaptureSpeed,
          projectedRelativeCaptureSpeed,
        } = defensiveCounterBudget({
          homeTroops: player.troops(),
          maxTroops: plannerMaxTroops,
          totalIncomingTroops: totalIncoming,
          selectedIncomingTroops: incoming.troops,
          activeIncomingFronts: incomingAttacks.length,
          reserveFloorRatio: Math.max(
            frontPolicy.reserveFloor,
            Math.min(0.75, 0.4 + (incomingAttacks.length - 1) * 0.1),
          ),
        });
        if (
          counterTroops <= 0 ||
          player.troops() / Math.max(1, this.game.config().maxTroops(player)) <
            0.4
        ) {
          this.follow(attacker, 6);
          this.setDecision(
            "Hold the home reserve and slow the strongest front",
            `The selected front is receiving ${renderTroops(incoming.troops)}, while ${renderTroops(protectedTroops)} must remain home to cover the visible invasion and the 40% capacity floor. No counterattack is launched; the central defense post and terrain must buy time while troops regenerate.`,
          );
          return;
        }
        const fraction = Math.min(
          0.6,
          counterTroops / Math.max(1, player.troops()),
        );
        if (
          !shouldLaunchDefensiveCounter({
            homeTroops: player.troops(),
            selectedIncomingTroops: incoming.troops,
            counterTroops,
            currentRelativeCaptureSpeed,
            projectedRelativeCaptureSpeed,
          })
        ) {
          if (
            shouldTradeLandForTime({
              reserveRatio: incomingReserveRatio,
              incomingTroopRatio: totalIncoming / Math.max(1, player.troops()),
              activeIncomingFronts: incomingAttacks.length,
            })
          ) {
            this.follow(player, 6);
            this.setDecision(
              "Trade outer land for regeneration time",
              `${renderTroops(totalIncoming)} incoming troops cannot be cancelled without crossing the home reserve floor. The trainer is yielding outer tiles while its troops regenerate.`,
            );
            return;
          }
          this.follow(attacker, 6);
          this.setDecision(
            "Regenerate behind the central defense",
            "Any counterattack would break the invasion-adjusted 40% home reserve floor, so the AI is trading outer land for time without spending troops on a token squad.",
          );
          return;
        }
        // The emitted intent is applied asynchronously. Do not make a second
        // decision against the stale pre-counter troop balance this tick.
        this.nextDecisionTick = this.game.ticks() + 1;
        this.attack(
          player,
          attacker,
          fraction,
          incomingAttacks.length > 1
            ? "Throttle the largest front"
            : "Slow the active force to a crawl",
          `${renderTroops(totalIncoming)} are incoming across ${incomingAttacks.length} front${incomingAttacks.length === 1 ? "" : "s"}. This counter removes ${renderTroops(counterTroops)} from the selected force without over-cancelling it, leaving about ${renderTroops(remainingIncomingTroops)} at ${(projectedAttackerToDefenderRatio * 100).toFixed(2)}% of the surviving live home army. The engine projects roughly ${Math.round(projectedRelativeCaptureSpeed * 100)}% of maximum capture speed while ${renderTroops(protectedTroops)} remain home.`,
        );
        return;
      }
    }

    this.setPlanningStage("alliance-coordination");
    if (
      await this.tryCoordinateWithAllies(
        player,
        frontPolicy.reserveFloor,
        activeNationWarIDs.size,
        borderingPlayers,
      )
    ) {
      return;
    }

    this.setPlanningStage("alliance-lifecycle");
    if (
      this.tryManageAllianceLifecycle(
        player,
        borderingPlayers,
        activeNationWarIDs.size,
      )
    ) {
      return;
    }

    this.setPlanningStage("remnant-cleanup");
    if (
      this.tryFinishRemnant(
        player,
        enemies,
        frontIntel,
        frontPolicy.reserveFloor,
        activeBorderNationWarIDs.size,
        frontPolicy.maxNationOffensives,
      )
    ) {
      return;
    }

    let strikePreferred = false;
    const idleGrowthReserve =
      player.troops() / Math.max(1, this.game.config().maxTroops(player));
    const hasTribeBorder = [...enemies.values()].some(
      (candidate) => candidate.type() === PlayerType.Bot,
    );
    // Growth trigger: a full bank with no active front is wasted regeneration
    // potential. Give a legal tribe conquest one decision pass before optional
    // naval or infrastructure work once the tick-one wilderness opening ends.
    this.setPlanningStage("growth-trigger");
    if (
      shouldTriggerIdleGrowth({
        tick: this.game.ticks(),
        reserveRatio: idleGrowthReserve,
        outgoingFronts: player.outgoingAttacks().length,
        hasTribeBorder,
      }) &&
      this.tryConquerTribe(
        player,
        enemies,
        frontIntel,
        idleGrowthReserve,
        frontPolicy.reserveFloor,
      )
    ) {
      return;
    }
    const proactiveNationThreats = [...enemies.values()].filter(
      (candidate) => candidate.type() === PlayerType.Nation,
    );
    if (
      incomingAttacks.length === 0 &&
      shouldPreFortifyInfrastructure({
        borderingNationThreats: proactiveNationThreats.length,
        strategicStructures: strategicStructures.length,
        reserveRatio: idleGrowthReserve,
        reserveFloorRatio: frontPolicy.reserveFloor,
        outgoingFronts: player.outgoingAttacks().length,
        defensePosts: player.units(UnitType.DefensePost).length,
        cities: player.units(UnitType.City).length,
      })
    ) {
      this.setPlanningStage("proactive-defense");
      if (
        await this.tryBuildDefensePost(
          player,
          incomingAttacks,
          proactiveNationThreats,
          borders,
        )
      )
        return;
    }
    this.setPlanningStage("strategic-actions");
    if (this.strategicPlan.action === "strike") {
      strikePreferred = true;
    }
    // Port and fleet execution waits until the current economy and module
    // ratios have been evaluated below. This avoids acting on the previous
    // cycle's budget or globally counted ships.
    if (player.outgoingAttacks().length >= openingFrontLimit) {
      this.setDecision(
        player.numTilesOwned() < 2_000
          ? "Drive the opening tribe fronts"
          : "Observe active fronts",
        `${openingFrontLimit} attacks are already running. The trainer is letting those fronts resolve before dividing troops again.`,
      );
      return;
    }

    const maxTroops = Math.max(1, this.game.config().maxTroops(player));
    this.setPlanningStage("economy");
    const reserveRatio = player.troops() / maxTroops;
    const projectedLandTiles =
      player.numTilesOwned() +
      Math.max(24, Math.ceil(player.numTilesOwned() * 0.12));
    const landCapacityProjection = projectLandCapacity({
      currentTiles: player.numTilesOwned(),
      projectedTiles: projectedLandTiles,
      currentMaxTroops: maxTroops,
      currentTroops: player.troops(),
    });
    this.landCapacityProjection = landCapacityProjection;
    const trapped = isStrategicallyTrapped({
      hasNeutralLand,
      hasSeaAccess,
      hostileBorders: enemies.size,
    });
    const incomingTroopRatio =
      incomingAttacks.reduce((sum, attack) => sum + attack.troops, 0) /
      Math.max(1, player.troops());
    const outgoingCommittedRatio =
      player.outgoingAttacks().reduce((sum, attack) => sum + attack.troops, 0) /
      maxTroops;
    const economy = this.analyzeEconomicConnections(player);
    const baselineDesiredCityCount = desiredDefensiveCityCount({
      enemyFronts: enemies.size,
      activeWars: activeNationWarIDs.size,
      incomingFronts: incomingAttacks.length,
      ownedCities: economy.cities,
      ownedTiles: player.numTilesOwned(),
      reserveRatio,
      incomingTroopRatio:
        incomingAttacks.reduce((sum, attack) => sum + attack.troops, 0) /
        maxTroops,
    });
    const conquestRequirements = [...enemies.values()].map(
      (candidate) =>
        candidate.troops() *
        terrainAdjustedAdvantageFor(candidate, frontIntel.get(candidate.id())),
    );
    const easiestConquestRequirement =
      conquestRequirements.length === 0
        ? maxTroops
        : Math.min(...conquestRequirements);
    const desiredEconomicCityCount = desiredCapacityEscapeCityCount({
      baselineDesiredCities: baselineDesiredCityCount,
      ownedCities: economy.cities,
      noGrowthTicks,
      reserveRatio,
      incomingFronts: incomingAttacks.length,
      maxTroops,
      requiredTroops: easiestConquestRequirement,
      cityTroopIncrease: this.game.config().cityTroopIncrease(),
    });
    this.economicPlan = planEconomicSystems({
      gold: Number(player.gold()),
      incomePerMinute: this.estimatedIncomePerMinute,
      reserveRatio,
      incomingTroopRatio:
        incomingAttacks.reduce((sum, attack) => sum + attack.troops, 0) /
        maxTroops,
      hostileFronts: enemies.size,
      activeNationWars: activeNationWarIDs.size,
      hasNeutralLand,
      trapped,
      cities: economy.cities,
      desiredCities: desiredEconomicCityCount,
      stackedCities: economy.stackedCities,
      factories: economy.factories,
      productiveFactoryStops: economy.factoryProductiveStops,
      isolatedFactories: economy.isolatedFactories,
      ports: economy.ports,
      factoryConnectedPorts: economy.factoryConnectedPorts,
      unconnectedPorts: economy.unconnectedPorts,
      tradePartners: hasSeaAccess ? economy.tradePartners : 0,
      embargoedPartners: economy.embargoedPartners,
      railStops: economy.railStops,
      connectedRailStops: economy.connectedRailStops,
      defensePosts: economy.defensePosts,
      strategicStructures: economy.strategicStructures,
      exposedEconomicStructures: economy.exposedEconomicStructures,
      cityCost: economicCosts.city,
      factoryCost: economicCosts.factory,
      portCost: economicCosts.port,
      defensePostCost: economicCosts.defensePost,
    });
    const cityBudget = capacityEscapeCityBudget({
      gold: Number(player.gold()),
      protectedSpendableGold: this.economicPlan.spendableGold,
      cityCost: economicCosts.city,
      cities: economy.cities,
      desiredCities: desiredEconomicCityCount,
      requiredTroops: easiestConquestRequirement,
      maxTroops,
      incomingFronts: incomingAttacks.length,
      hostileFronts: enemies.size,
      activeNationWars: activeNationWarIDs.size,
      reserveRatio,
    });
    const ownWarships = player.units(UnitType.Warship);
    const ownedPorts = player.units(UnitType.Port);
    const desiredWarships = desiredWarshipCount({
      nearbyHostileWarships: navalSituation.hostileWarships.length,
      nearbyHostileTransports: navalSituation.hostileTransports.length,
      vulnerableTradeShips: navalSituation.tradeTargets.length,
      navalBias: this.activeGene("Naval"),
    });
    const maxWarshipHealth =
      this.game.unitInfo(UnitType.Warship).maxHealth ?? 1;
    const veterancyHealthBonus = this.game
      .config()
      .warshipVeterancyHealthBonus();
    const damagedWarshipLoad = ownWarships.reduce((load, warship) => {
      if (!warship.hasHealth()) return load;
      return (
        load +
        Math.max(
          0,
          1 -
            warshipHealthRatio(
              warship.health(),
              maxWarshipHealth,
              warship.veterancy(),
              veterancyHealthBonus,
            ),
        )
      );
    }, 0);
    const dockCapacity = ownedPorts.reduce(
      (capacity, port) => capacity + port.level(),
      0,
    );
    const ownSams = player.units(UnitType.SAMLauncher);
    const coveredCriticalStructures = strategicStructures.filter((structure) =>
      ownSams.some(
        (sam) =>
          sam.isActive() &&
          !sam.isUnderConstruction() &&
          this.game.euclideanDistSquared(structure.tile(), sam.tile()) <=
            this.game.config().samRange(sam.level()) ** 2,
      ),
    ).length;
    const samCoverageRatio =
      coveredCriticalStructures / Math.max(1, strategicStructures.length);
    const criticalStructureClustering =
      strategicStructures.length < 2
        ? 0
        : strategicStructures.filter((structure) =>
            strategicStructures.some(
              (other) =>
                other !== structure &&
                this.game.euclideanDistSquared(
                  structure.tile(),
                  other.tile(),
                ) <=
                  this.game.config().nukeMagnitudes(UnitType.AtomBomb).outer **
                    2,
            ),
          ).length / strategicStructures.length;
    const incomingStrategicWeapons = this.game
      .units(UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV)
      .filter(
        (weapon) =>
          weapon.isActive() &&
          weapon.owner() !== player &&
          !player.isFriendly(weapon.owner()),
      ).length;
    const strategicSurvival = evaluateStrategicSurvival({
      enemySiloCount: enemyMissileSilos,
      incomingStrategicWeapons,
      samCoverageRatio,
      criticalLandSamCoverageRatio: samCoverageRatio,
      criticalStructureClustering,
      recentBlastRisk: 0,
      gold: Number(player.gold()),
      samCost: economicCosts.sam,
      activeAttackCommitmentRatio: outgoingCommittedRatio,
      reserveRatio,
      enemyMirvProgress: Math.min(1, enemyMissileSilos / 4),
      estimatedTicksUntilEnemyMirv:
        enemyMissileSilos > 0
          ? Math.max(0, 900 - this.game.ticks())
          : undefined,
    });
    this.strategicCapability = planStrategicCapability({
      ownSilos: ownSilos.length,
      readyLaunchSlots: readyStrategicSlots,
      affordableWeapons: affordableStrategicWeapons,
      actionableTargets: strategicTargetPlayers.length,
      enemySilos: enemyMissileSilos,
      highestThreat: Math.max(
        0,
        ...opponentModels.map((model) => model.forecastThreat ?? 0),
      ),
      reserveRatio,
      incomingPressureRatio: incomingTroopRatio,
      activeNationWars: activeNationWarIDs.size,
      gold: Number(player.gold()),
      reserveGold: this.economicPlan.goldReserveFloor,
      siloCost: economicCosts.silo,
    });
    const moduleCoordination = this.aiModules.evaluateCoordinated({
      tick: this.game.ticks(),
      reserveRatio,
      maxTroops,
      troops: player.troops(),
      gold: Number(player.gold()),
      incomingTroopRatio,
      outgoingCommittedRatio,
      activeFronts: incomingAttacks.length + player.outgoingAttacks().length,
      neutralLandAvailable: hasNeutralLand,
      activeNationWars: activeNationWarIDs.size,
      borderPressure: Math.min(1, incomingTroopRatio),
      economyReturnScore: this.economicPlan.economyReturnScore,
      usefulPortSites: hasSeaAccess ? economy.tradePartners : 0,
      existingPorts: economy.ports,
      existingCities: economy.cities,
      existingDefensePosts: economy.defensePosts,
      existingSams: player.units(UnitType.SAMLauncher).length,
      existingSilos: player.units(UnitType.MissileSilo).length,
      infrastructureNeedScore: this.economicPlan.infrastructureNeedScore,
      strategicWeaponValue: this.strategicCapability.opportunityValue,
      allyAidUrgency: 0,
      incomePerMinute: this.estimatedIncomePerMinute,
      emergencyGoldFloor: this.economicPlan.goldReserveFloor,
      incomingStrikeRisk: Math.min(
        1,
        enemyMissileSilos /
          Math.max(1, player.units(UnitType.SAMLauncher).length * 2 + 2),
      ),
      uncoveredCriticalStructures: economy.exposedEconomicStructures,
      productiveStackSites: Math.max(
        0,
        desiredEconomicCityCount - economy.stackedCities,
      ),
      coastalEconomicTargets: navalSituation.tradeTargets.length,
      enemyWarshipsNearTargets: navalSituation.hostileWarships.length,
      hostileTransportsNearCoast: navalSituation.hostileTransports.length,
      enemyMissileSilos,
      landCapacityGain: landCapacityProjection.capacityGain,
      landRegenerationMultiplier: landCapacityProjection.regenerationMultiplier,
      existingFactories: economy.factories,
      factoryConnectedPorts: economy.factoryConnectedPorts,
      spendableGold: this.economicPlan.spendableGold,
      portCost: economicCosts.port,
      tradePartners: economy.tradePartners,
      embargoedPartners: economy.embargoedPartners,
      ownWarships: ownWarships.length,
      desiredWarships,
      damagedWarships: damagedWarshipLoad,
      dockCapacity,
      transportLossRate: this.transportLossRate(),
      connectedRailStops: economy.connectedRailStops,
      railStops: economy.railStops,
      navalBias: this.activeGene("Naval"),
      activeFrontRatio:
        (incomingAttacks.length + player.outgoingAttacks().length) /
        Math.max(1, enemies.size),
      tradeCoverageTargetRatio: this.economicPlan.tradeCoverageTargetRatio,
    });
    this.moduleCoordination = moduleCoordination;
    this.moduleSignals = moduleCoordination.signals;
    const moduleDecisions = moduleCoordination.decisions;
    const troopModule = moduleDecisions.find(
      ({ moduleID }) => moduleID === "troop-economy",
    );
    const goldModule = moduleDecisions.find(
      ({ moduleID }) => moduleID === "gold-budget",
    );
    if (
      moduleCoordination.consensusAction === "hold" &&
      troopModule?.action === "hold" &&
      reserveRatio < 0.34
    ) {
      this.follow(player, 6);
      this.setDecision(
        "Regenerate before committing troops",
        `${troopModule.reason}. Current reserve is ${Math.round(reserveRatio * 100)}% of ${renderTroops(maxTroops)} capacity; the module registry is holding attacks until regeneration restores a usable reserve.`,
      );
      return;
    }
    if (
      goldModule?.action === "hold" &&
      typeof goldModule.data?.reserveFloor === "number" &&
      Number(player.gold()) < goldModule.data.reserveFloor &&
      reserveRatio < 0.5
    ) {
      this.follow(player, 6);
      this.setDecision(
        "Protect the economic reserve",
        `${goldModule.reason}. The gold-budget module is keeping the treasury available for recovery while troop regeneration is still below 50%.`,
      );
      return;
    }
    this.setPlanningStage("strategic-construction");
    if (
      await this.tryBuildStrategicSam(
        player,
        borders.borderTiles,
        strategicStructures,
        strategicSurvival,
        economicCosts.sam,
      )
    ) {
      return;
    }
    if (
      await this.tryBuildStrategicSilo(
        player,
        borders.borderTiles,
        this.strategicCapability,
        economicCosts.silo,
      )
    ) {
      return;
    }
    if (
      this.economicPlan.action === "bank" &&
      !cityBudget.bypassBank &&
      reserveRatio < frontPolicy.reserveFloor
    ) {
      this.follow(player, 6);
      this.setDecision(
        "Bank for connected economic recovery",
        `${this.economicPlan.reason}. Live income is estimated at ${Math.round(this.estimatedIncomePerMinute).toLocaleString()} gold/minute, leaving ${Math.round(this.economicPlan.spendableGold).toLocaleString()} gold above the replacement and risk reserve. Troop reserves are also below the ${Math.round(frontPolicy.reserveFloor * 100)}% multi-front floor, so both spending and attacks wait.`,
      );
      return;
    }
    if (
      this.economicPlan.action === "protect-assets" &&
      economy.exposedEconomicStructures > 0
    ) {
      this.setPlanningStage("economic-protection");
      if (
        await this.tryBuildDefensePost(
          player,
          incomingAttacks,
          proactiveNationThreats,
          borders,
        )
      ) {
        return;
      }
    }
    if (player.gold() >= (trapped ? 10_000n : 50_000n)) {
      const stationRange = this.game.config().trainStationMaxRange();
      const stationMinimumRange = this.game.config().trainStationMinRange();
      const factories = player.units(UnitType.Factory);
      const unconnectedShipyards = player.units(UnitType.Port).filter(
        (port) =>
          !port.hasTrainStation() ||
          !factories.some((factory) => {
            return isWithinRailConnectionRange({
              distanceSquared: this.game.euclideanDistSquared(
                port.tile(),
                factory.tile(),
              ),
              minimumRange: stationMinimumRange,
              maximumRange: stationRange,
            });
          }),
      );
      const needsShipyardFactory =
        unconnectedShipyards.length > 0 &&
        (this.moduleSignals.portAction === "connect" ||
          (this.moduleSignals.shipyardFactoryConnectionPriority ?? 0) >= 0.5);
      const stations = player
        .units(UnitType.City, UnitType.Factory, UnitType.Port)
        .filter((unit) => unit.hasTrainStation());
      const cities = player.units(UnitType.City);
      const cityCount = cities.length;
      const desiredCityCount = desiredEconomicCityCount;
      const needsPressureCity = cityCount < desiredCityCount;
      const needsGrowthFactory = shouldFundFirstPressureFactory({
        factories: factories.length,
        cities: cityCount,
        ownedTiles: player.numTilesOwned(),
        reserveRatio,
        incomingFronts: incomingAttacks.length,
        hostileFronts: enemies.size,
        activeNationWars: activeNationWarIDs.size,
        noGrowthTicks,
        unconnectedPorts: unconnectedShipyards.length,
      });
      const factorySpendableGold = needsGrowthFactory
        ? Math.max(this.economicPlan.spendableGold, Number(player.gold()))
        : this.economicPlan.spendableGold;
      const shouldEvaluateFactoryOpportunity =
        this.game.ticks() >= this.nextFactoryOpportunityTick &&
        (needsGrowthFactory ||
          needsShipyardFactory ||
          this.economicPlan.action === "activate-rail" ||
          this.economicPlan.action === "extend-trade");
      const defensePosts = player.units(UnitType.DefensePost);
      const factoryUpgradeCandidates = shouldEvaluateFactoryOpportunity
        ? selectFactoryUpgradeCandidates(
            factories.map((factory) => {
              const nearbyStops = this.game
                .nearbyUnits(
                  factory.tile(),
                  stationRange,
                  [UnitType.City, UnitType.Port],
                  ({ unit }) => {
                    const owner = unit.owner() as PlayerView;
                    return (
                      owner === player ||
                      (owner.isAlive() &&
                        !player.hasEmbargo(owner) &&
                        !owner.hasEmbargo(player))
                    );
                  },
                )
                .filter(
                  ({ distSquared }) => distSquared >= stationMinimumRange ** 2,
                );
              const countStops = (
                owner: "own" | "external",
                type: UnitType,
              ): number =>
                nearbyStops.filter(
                  ({ unit }) =>
                    unit.type() === type &&
                    (owner === "own"
                      ? unit.owner() === player
                      : unit.owner() !== player),
                ).length;
              const ownCities = countStops("own", UnitType.City);
              const ownPorts = countStops("own", UnitType.Port);
              const externalCities = countStops("external", UnitType.City);
              const externalPorts = countStops("external", UnitType.Port);
              const productiveStops =
                ownCities + ownPorts + externalCities + externalPorts;
              const protectedByDefensePost = defensePosts.some(
                (post) =>
                  this.game.euclideanDistSquared(factory.tile(), post.tile()) <=
                  this.game.config().defensePostRange() ** 2,
              );
              const economicScore =
                (ownCities +
                  ownPorts * 1.3 +
                  externalCities * 1.25 +
                  externalPorts * 1.6) *
                (protectedByDefensePost ? 1.2 : 0.7);
              return {
                factory,
                ownCities,
                ownPorts,
                externalCities,
                externalPorts,
                productiveStops,
                protectedByDefensePost,
                economicScore,
              };
            }),
            (candidate) =>
              candidate.economicScore * (1 + candidate.factory.level() * 0.25),
            4,
          )
        : [];
      const factoryUpgradePlans = await Promise.all(
        factoryUpgradeCandidates.map(async (candidate) => {
          const plan = (
            await player.buildables(candidate.factory.tile(), [
              UnitType.Factory,
            ])
          )[0];
          return { ...candidate, plan };
        }),
      );
      const highValueFactory = factoryUpgradePlans
        .filter(
          ({ productiveStops, economicScore, plan }) =>
            productiveStops >= 2 &&
            economicScore >= 2 &&
            plan?.canUpgrade !== false &&
            plan?.canUpgrade !== undefined &&
            this.economicPlan !== undefined &&
            this.economicPlan.spendableGold >= Number(plan.cost),
        )
        .sort(
          (a, b) =>
            b.economicScore * (1 + b.factory.level() * 0.25) -
            a.economicScore * (1 + a.factory.level() * 0.25),
        )[0];
      if (
        !needsPressureCity &&
        !needsShipyardFactory &&
        (this.economicPlan.action === "activate-rail" ||
          this.economicPlan.action === "extend-trade") &&
        highValueFactory?.plan.canUpgrade !== false &&
        highValueFactory?.plan.canUpgrade !== undefined
      ) {
        this.eventBus.emit(
          new SendUpgradeStructureIntentEvent(
            highValueFactory.plan.canUpgrade,
            UnitType.Factory,
          ),
        );
        this.nextEconomicCostRefreshTick = 0;
        this.nextFactoryOpportunityTick = factoryOpportunityRetryTick(
          this.game.ticks(),
          "built",
        );
        this.follow(player, 7);
        this.setDecision(
          "Upgrade a protected productive factory",
          `This level-${highValueFactory.factory.level()} factory serves ${highValueFactory.ownCities + highValueFactory.ownPorts} owned and ${highValueFactory.externalCities + highValueFactory.externalPorts} non-embargoed external stops (system score ${highValueFactory.economicScore.toFixed(1)})${highValueFactory.protectedByDefensePost ? " under defense-post coverage" : ""}. The upgrade compounds an active network instead of subsidizing an isolated factory.`,
        );
        return;
      }
      const structureMinDistance = this.game.config().structureMinDist();
      const interiorCandidates = this.interiorBuildCandidates(
        player,
        borders.borderTiles,
        Math.max(14, Math.ceil(structureMinDistance * 2)),
      );
      const interiorDepths = new Map(
        interiorCandidates.map(({ tile, depth }) => [tile, depth]),
      );
      const safestDepth = interiorCandidates[0]?.depth ?? 0;
      const safeInteriorCandidates = interiorCandidates.filter(
        ({ depth }) => depth >= Math.max(0, safestDepth - 3),
      );
      const economicStops = player.units(UnitType.City, UnitType.Port).length;
      const externalEconomicStops = this.game
        .units(UnitType.City, UnitType.Port)
        .filter(
          (unit) =>
            unit.owner() !== player &&
            unit.owner().isAlive() &&
            !player.hasEmbargo(unit.owner()) &&
            !unit.owner().hasEmbargo(player),
        ).length;
      const desiredFactories = Math.min(
        3,
        Math.max(
          needsGrowthFactory ? 1 : 0,
          desiredFactoryCount({
            economicStops: economicStops + externalEconomicStops,
            ownedCities: cityCount,
            ownedTiles: player.numTilesOwned(),
            gold: factorySpendableGold,
            reserveRatio,
          }),
        ),
      );
      if (
        (!needsPressureCity || needsGrowthFactory) &&
        (needsGrowthFactory ||
          this.economicPlan.action === "activate-rail" ||
          this.economicPlan.action === "extend-trade" ||
          needsShipyardFactory) &&
        (economicStops + externalEconomicStops >= 2 || needsShipyardFactory) &&
        (factories.length < desiredFactories || needsShipyardFactory) &&
        this.game.ticks() >= this.nextFactoryOpportunityTick
      ) {
        const countRailBends = (
          paths: readonly (readonly number[])[] = [],
        ): number =>
          paths.reduce((total, path) => {
            let bends = 0;
            let previousDirection: string | undefined;
            for (let index = 1; index < path.length; index++) {
              const previous = path[index - 1];
              const current = path[index];
              const direction = `${this.game.x(current) - this.game.x(previous)},${this.game.y(current) - this.game.y(previous)}`;
              if (
                previousDirection !== undefined &&
                direction !== previousDirection
              )
                bends++;
              previousDirection = direction;
            }
            return total + bends;
          }, 0);
        const describeFactoryConnections = (tile: number) => {
          const nearbyStructures = this.game
            .nearbyUnits(
              tile,
              stationRange,
              [UnitType.City, UnitType.Port, UnitType.Factory],
              ({ unit }) => {
                const owner = unit.owner() as PlayerView;
                return (
                  owner === player ||
                  (owner.isAlive() &&
                    !player.hasEmbargo(owner) &&
                    !owner.hasEmbargo(player))
                );
              },
            )
            .filter(
              ({ distSquared }) => distSquared >= stationMinimumRange ** 2,
            );
          const countConnections = (
            owner: "own" | "external",
            type: UnitType,
          ): number =>
            nearbyStructures.filter(
              ({ unit }) =>
                unit.type() === type &&
                (owner === "own"
                  ? unit.owner() === player
                  : unit.owner() !== player),
            ).length;
          const ownCities = countConnections("own", UnitType.City);
          const ownPorts = countConnections("own", UnitType.Port);
          const externalCities = countConnections("external", UnitType.City);
          const externalPorts = countConnections("external", UnitType.Port);
          const factoryCorridorConnections =
            countConnections("own", UnitType.Factory) +
            countConnections("external", UnitType.Factory);
          const productiveConnections =
            ownCities + ownPorts + externalCities + externalPorts;
          return {
            ownCities,
            ownPorts,
            externalCities,
            externalPorts,
            factoryCorridorConnections,
            productiveConnections,
          };
        };
        const factoryCandidatePool = new Map(
          safeInteriorCandidates.map((candidate) => [
            candidate.tile,
            candidate,
          ]),
        );
        if (needsShipyardFactory) {
          for (const candidate of interiorCandidates) {
            const connectsShipyard = unconnectedShipyards.some((port) => {
              const distance = this.game.euclideanDistSquared(
                candidate.tile,
                port.tile(),
              );
              return (
                distance >= stationMinimumRange ** 2 &&
                distance <= stationRange ** 2
              );
            });
            if (connectsShipyard && candidate.depth >= 3) {
              factoryCandidatePool.set(candidate.tile, candidate);
            }
          }
        }
        const factoryCandidates = [...factoryCandidatePool.values()]
          .map(({ tile, depth }) => {
            const connections = describeFactoryConnections(tile);
            const connectsUnconnectedShipyard = unconnectedShipyards.some(
              (port) =>
                isWithinRailConnectionRange({
                  distanceSquared: this.game.euclideanDistSquared(
                    tile,
                    port.tile(),
                  ),
                  minimumRange: stationMinimumRange,
                  maximumRange: stationRange,
                }),
            );
            return {
              tile,
              depth,
              ...connections,
              connectsUnconnectedShipyard,
              preliminaryScore:
                connections.ownCities +
                connections.ownPorts * 1.3 +
                connections.externalCities * 1.25 +
                connections.externalPorts * 1.6 +
                (connectsUnconnectedShipyard ? 8 : 0),
            };
          })
          // A Factory stop itself pays no train gold. Require at least two
          // actual City/Port destinations instead of counting factories as
          // productive trade stops.
          .filter(
            ({ productiveConnections, connectsUnconnectedShipyard }) =>
              productiveConnections >= 2 ||
              (needsShipyardFactory && connectsUnconnectedShipyard),
          )
          .sort(
            (a, b) =>
              b.preliminaryScore - a.preliminaryScore || b.depth - a.depth,
          )
          .slice(0, 8);
        const factoryPlans = await Promise.all(
          factoryCandidates.map(async ({ tile, depth }) => {
            const plan = (await player.buildables(tile, [UnitType.Factory]))[0];
            const railBends = countRailBends(plan?.ghostRailPaths);
            const spawnTile =
              plan?.canBuild === false || plan?.canBuild === undefined
                ? tile
                : plan.canBuild;
            const actualConnections = describeFactoryConnections(spawnTile);
            const actualDepth = interiorDepths.get(spawnTile) ?? depth;
            const nearestFactoryDistance =
              factories.length === 0
                ? undefined
                : Math.sqrt(
                    Math.min(
                      ...factories.map((factory) =>
                        this.game.euclideanDistSquared(
                          spawnTile,
                          factory.tile(),
                        ),
                      ),
                    ),
                  );
            const placement = scoreFactoryPlacement({
              ...actualConnections,
              overlappingRailroads: plan?.overlappingRailroads.length ?? 0,
              ghostPathLengths:
                plan?.ghostRailPaths.map((path) => path.length) ?? [],
              railBends,
              depth: actualDepth,
              safestDepth,
              nearestFactoryDistance,
              minimumRange: stationMinimumRange,
              maximumRange: stationRange,
            });
            return {
              depth: actualDepth,
              ...actualConnections,
              placement,
              railBends,
              plan,
            };
          }),
        );
        const factory = factoryPlans
          .filter(
            ({ plan }) =>
              plan?.canBuild !== false &&
              plan?.canBuild !== undefined &&
              // A factory must either snap to an existing railroad or have a
              // legal ghost path to one; distance alone is not a rail route.
              ((plan.overlappingRailroads?.length ?? 0) > 0 ||
                (plan.ghostRailPaths?.length ?? 0) > 0) &&
              factorySpendableGold >= Number(plan.cost),
          )
          .sort((a, b) => b.placement.score - a.placement.score)[0];
        if (
          factory?.plan.canBuild !== false &&
          factory?.plan.canBuild !== undefined
        ) {
          this.eventBus.emit(
            new BuildUnitIntentEvent(UnitType.Factory, factory.plan.canBuild),
          );
          this.nextEconomicCostRefreshTick = 0;
          this.nextFactoryOpportunityTick = factoryOpportunityRetryTick(
            this.game.ticks(),
            "built",
          );
          this.follow(player, 7);
          this.setDecision(
            needsShipyardFactory
              ? "Connect the isolated shipyard to a factory"
              : needsGrowthFactory
                ? "Build the first growth factory"
                : "Build a factory to activate the rail economy",
            `This safe interior factory links ${factory.ownCities} owned cities, ${factory.ownPorts} owned ports, and ${factory.externalCities + factory.externalPorts} non-embargoed external stops within the legal ${stationMinimumRange}–${stationRange} tile band. Its actual rail plan scores ${factory.placement.score.toFixed(1)} with ${(factory.placement.railEfficiency * 100).toFixed(0)}% route efficiency and ${factory.railBends} bends${needsGrowthFactory ? `; ${noGrowthTicks >= 240 ? `${noGrowthTicks} stalled ticks` : `${enemies.size + activeNationWarIDs.size} combined fronts and wars`} make first-factory compounding more valuable than another passive full bank` : ""}.`,
          );
          return;
        }
        const bestFactory = factoryPlans.find(
          ({ plan, placement }) =>
            plan !== undefined && placement.productiveStops >= 2,
        );
        if (
          bestFactory?.plan !== undefined &&
          factorySpendableGold < Number(bestFactory.plan.cost) &&
          (!hasNeutralLand || player.numTilesOwned() >= 2_000)
        ) {
          this.nextFactoryOpportunityTick = factoryOpportunityRetryTick(
            this.game.ticks(),
            "unaffordable",
          );
          this.setDecision(
            "Queue a proven factory opportunity",
            `${bestFactory.placement.productiveStops} economic stops can be linked from a safe interior site (placement score ${bestFactory.placement.score.toFixed(1)}). The trainer will revisit this concrete opportunity, but it will continue evaluating expansion and capacity instead of blocking the decision cycle.`,
          );
        }
      }
      if (
        shouldEvaluateFactoryOpportunity &&
        this.nextFactoryOpportunityTick <= this.game.ticks()
      ) {
        this.nextFactoryOpportunityTick = factoryOpportunityRetryTick(
          this.game.ticks(),
          "saturated",
        );
      }
      const ownedPorts = player.units(UnitType.Port);
      const partnerPorts = this.game
        .units(UnitType.Port)
        .filter(
          (port) =>
            port.owner() !== player &&
            port.owner().isAlive() &&
            !player.hasEmbargo(port.owner()) &&
            !port.owner().hasEmbargo(player),
        );
      const targetPartnerCoverage =
        this.moduleSignals.portTargetPartnerCoverageRatio ?? 0.1;
      const desiredTradePorts = Math.max(
        1,
        Math.ceil(partnerPorts.length * targetPartnerCoverage),
      );
      if (
        this.economicPlan.action === "extend-trade" &&
        partnerPorts.length > 0 &&
        ownedPorts.length < desiredTradePorts &&
        this.moduleSignals.portAction === "trade"
      ) {
        const ownedShores = [...borders.borderTiles].filter(
          (tile) => this.game.isShore(tile) && !this.game.isImpassable(tile),
        );
        const candidateSampleRatio =
          this.moduleSignals.portCandidateSampleRatio ?? 0.2;
        const sampleCount = Math.min(
          96,
          Math.max(1, Math.ceil(ownedShores.length * candidateSampleRatio)),
        );
        const sampledShores =
          ownedShores.length <= sampleCount
            ? ownedShores
            : Array.from(
                { length: sampleCount },
                (_, index) =>
                  ownedShores[
                    Math.floor(
                      (index * (ownedShores.length - 1)) /
                        Math.max(1, sampleCount - 1),
                    )
                  ],
              );
        const mapDiagonal = Math.max(
          1,
          Math.hypot(this.game.width(), this.game.height()),
        );
        const routeByID = new Map<
          string,
          { tile: number; partner: (typeof partnerPorts)[number] }
        >();
        const tradeShipSpawnInterval =
          this.game
            .config()
            .tradeShipSpawnRate(0, this.game.units(UnitType.TradeShip).length) *
          10;
        const tradeSurvivalRatio = Math.max(
          0.3,
          Math.min(
            0.98,
            0.62 +
              (ownWarships.length /
                Math.max(
                  1,
                  ownWarships.length + navalSituation.hostileWarships.length,
                )) *
                0.36 -
              (navalSituation.hostileWarships.length /
                Math.max(1, ownedPorts.length + partnerPorts.length)) *
                0.08,
          ),
        );
        const tradeOptions = sampledShores.flatMap((tile) => {
          const factoryConnected = factories.some((factory) =>
            isWithinRailConnectionRange({
              distanceSquared: this.game.euclideanDistSquared(
                tile,
                factory.tile(),
              ),
              minimumRange: stationMinimumRange,
              maximumRange: stationRange,
            }),
          );
          const closestOwnPort = Math.min(
            ...ownedPorts.map((port) =>
              Math.sqrt(this.game.euclideanDistSquared(tile, port.tile())),
            ),
            mapDiagonal,
          );
          // GameView exposes terrain but not the simulation's mutable
          // water-component graph. Restrict projected trade to ocean shores,
          // which are guaranteed to be navigable, instead of inventing inland
          // lake connectivity in the client planner.
          const reachablePorts = this.game.isOceanShore(tile)
            ? partnerPorts.filter((partner) =>
                this.game.isOceanShore(partner.tile()),
              )
            : [];
          if (reachablePorts.length === 0) return [];
          const weightedRoutes = reachablePorts.map((partner) => {
            const distance = this.game.manhattanDist(tile, partner.tile());
            return {
              partner,
              distance,
              expectedGold: estimateTradeRouteGold(distance),
              weight: Math.max(1, partner.level()),
            };
          });
          const totalWeight = weightedRoutes.reduce(
            (sum, route) => sum + route.weight,
            0,
          );
          const expectedGold =
            weightedRoutes.reduce(
              (sum, route) => sum + route.expectedGold * route.weight,
              0,
            ) / Math.max(1, totalWeight);
          const routeDistance =
            weightedRoutes.reduce(
              (sum, route) => sum + route.distance * route.weight,
              0,
            ) / Math.max(1, totalWeight);
          const ownerWeights = new Map<string, number>();
          for (const route of weightedRoutes) {
            const ownerID = route.partner.owner().id();
            ownerWeights.set(
              ownerID,
              (ownerWeights.get(ownerID) ?? 0) + route.weight,
            );
          }
          const partnerConcentration =
            Math.max(0, ...ownerWeights.values()) / Math.max(1, totalWeight);
          const representative = weightedRoutes.sort(
            (a, b) => b.expectedGold - a.expectedGold,
          )[0].partner;
          const id = String(tile);
          routeByID.set(id, { tile, partner: representative });
          return [
            {
              id,
              expectedGold,
              buildCost: Math.max(1, economicCosts.port),
              routeDistance,
              closestFriendlyPortDistance: closestOwnPort,
              factoryConnected,
              survivalRatio: tradeSurvivalRatio,
              spawnIntervalTicks: tradeShipSpawnInterval,
              reachablePartners: ownerWeights.size,
              partnerConcentration,
            },
          ];
        });
        const rankedRoutes = rankAdaptiveTradePortOptions(
          {
            minimumSiteQuality:
              this.moduleSignals.portMinimumSiteQuality ?? 0.5,
            requiredReturnRatio:
              this.moduleSignals.portRequiredReturnRatio ?? 0.25,
            maximumPaybackTicks:
              this.moduleSignals.portMaximumPaybackTicks ?? 3_600,
            requireFactoryConnection:
              this.moduleSignals.portRequireFactoryConnection !== false,
          },
          tradeOptions,
        );
        const usedTiles = new Set<number>();
        const portCandidates = rankedRoutes
          .flatMap((route) => {
            const detail = routeByID.get(route.id);
            if (detail === undefined || usedTiles.has(detail.tile)) return [];
            usedTiles.add(detail.tile);
            return [{ ...route, ...detail }];
          })
          .slice(
            0,
            Math.min(
              12,
              Math.max(1, Math.ceil(sampleCount * candidateSampleRatio)),
            ),
          );
        const portPlans = await Promise.all(
          portCandidates.map(async (candidate) => ({
            ...candidate,
            plan: (await player.buildables(candidate.tile, [UnitType.Port]))[0],
          })),
        );
        const profitablePort = portPlans.find(
          ({ expectedGold, expectedGoldPerTick, plan, factoryConnected }) =>
            plan !== undefined &&
            (this.moduleSignals.portRequireFactoryConnection === false ||
              factoryConnected) &&
            expectedGold / Math.max(1, Number(plan.cost)) >=
              (this.moduleSignals.portRequiredReturnRatio ?? 0.25) &&
            Number(plan.cost) / Math.max(0.000_001, expectedGoldPerTick) <=
              (this.moduleSignals.portMaximumPaybackTicks ?? 3_600),
        );
        if (
          profitablePort?.plan.canBuild !== false &&
          profitablePort?.plan.canBuild !== undefined &&
          this.economicPlan.spendableGold >= Number(profitablePort.plan.cost)
        ) {
          this.eventBus.emit(
            new BuildUnitIntentEvent(
              UnitType.Port,
              profitablePort.plan.canBuild,
            ),
          );
          this.nextEconomicCostRefreshTick = 0;
          this.follow(profitablePort.partner.owner(), 6);
          this.setDecision(
            "Open a profitable trade port",
            `The adaptive route scores ${Math.round(profitablePort.score * 100)}% quality over ${Math.round(profitablePort.routeDistance)} tiles and returns ${Math.round(profitablePort.returnRatio * 100)}% of build cost per arrival, implying about ${(1 / Math.max(0.01, profitablePort.returnRatio)).toFixed(1)} arrivals to repay${profitablePort.factoryConnected ? " while joining the rail network" : ""}.`,
          );
          return;
        }
        if (
          profitablePort?.plan !== undefined &&
          this.economicPlan.spendableGold < Number(profitablePort.plan.cost) &&
          (this.moduleSignals.portActionUrgency ?? 0) >=
            (this.moduleSignals.landExpansionPriority ?? 0)
        ) {
          this.setDecision(
            "Save for a high-return trade port",
            `The route returns ${Math.round(profitablePort.returnRatio * 100)}% of its ${profitablePort.plan.cost.toLocaleString()} cost per arrival at ${Math.round(profitablePort.score * 100)}% relative site quality. Port urgency now exceeds the land-growth ratio, so the trainer is saving only the remaining cost above its protected reserve.`,
          );
          return;
        }
      }
      const borderingNationContacts = [...enemies.values()]
        .filter((enemy) => enemy.type() === PlayerType.Nation)
        .map((enemy) => ({
          enemy,
          contactTile: frontIntel.get(enemy.id())?.contactTile,
        }))
        .filter(
          (contact): contact is { enemy: PlayerView; contactTile: number } =>
            contact.contactTile !== undefined,
        );
      const cityCandidatePool = new Map<
        number,
        { tile: number; depth: number }
      >();
      for (const candidate of safeInteriorCandidates) {
        cityCandidatePool.set(candidate.tile, candidate);
      }
      const stackRadiusSquared = (structureMinDistance * 2.25) ** 2;
      const minimumStackDistanceSquared = (structureMinDistance * 0.95) ** 2;
      for (const candidate of interiorCandidates) {
        if (
          candidate.depth >= 3 &&
          cities.some((city) => {
            const distance = this.game.euclideanDistSquared(
              candidate.tile,
              city.tile(),
            );
            return (
              distance >= minimumStackDistanceSquared &&
              distance <= stackRadiusSquared
            );
          })
        ) {
          cityCandidatePool.set(candidate.tile, candidate);
        }
      }
      const describeCitySite = (tile: number, depth: number) => {
        const hasFactoryInRange = factories.some(
          (factory) =>
            this.game.euclideanDistSquared(tile, factory.tile()) <=
            stationRange ** 2,
        );
        const terrainDefense =
          this.game.terrainType(tile) === TerrainType.Mountain
            ? 80
            : this.game.terrainType(tile) === TerrainType.Highland
              ? 45
              : 0;
        const passableExits = this.game
          .neighbors(tile)
          .filter(
            (neighbor) =>
              this.game.isLand(neighbor) && !this.game.isImpassable(neighbor),
          ).length;
        const borderDefense = borderingNationContacts.reduce(
          (best, contact) => {
            const distance = Math.sqrt(
              this.game.euclideanDistSquared(tile, contact.contactTile),
            );
            const strength =
              contact.enemy.troops() /
              Math.max(1, this.game.config().maxTroops(contact.enemy));
            return Math.max(best, (strength * 100) / (1 + distance / 50));
          },
          0,
        );
        return {
          tile,
          depth,
          railConnections: railCityConnectionScore({
            hasFactoryInRange,
            stationDistancesSquared: hasFactoryInRange
              ? stations.map((station) =>
                  this.game.euclideanDistSquared(tile, station.tile()),
                )
              : [],
            minimumRange: stationMinimumRange,
            maximumRange: stationRange,
          }),
          stackPlacement: scoreCityStackPlacement({
            cityDistancesSquared: cities.map((city) =>
              this.game.euclideanDistSquared(tile, city.tile()),
            ),
            structureMinDistance,
          }),
          defenseScore:
            terrainDefense +
            Math.max(0, 6 - passableExits) * 12 +
            borderDefense,
        };
      };
      const cityCandidates = [...cityCandidatePool.values()]
        .map(({ tile, depth }) => describeCitySite(tile, depth))
        .sort(
          (a, b) =>
            b.defenseScore +
              b.railConnections * 20 -
              (a.defenseScore + a.railConnections * 20) +
              b.stackPlacement.score -
              a.stackPlacement.score || b.depth - a.depth,
        )
        .slice(0, 10);
      const cityPlans = await Promise.all(
        cityCandidates.map(async (candidate) => {
          const plan = (
            await player.buildables(candidate.tile, [UnitType.City])
          )[0];
          const actualTile =
            plan?.canBuild === false || plan?.canBuild === undefined
              ? candidate.tile
              : plan.canBuild;
          return {
            ...describeCitySite(
              actualTile,
              interiorDepths.get(actualTile) ?? candidate.depth,
            ),
            plan,
          };
        }),
      );
      const city = cityPlans
        .sort(
          (a, b) =>
            b.defenseScore +
              b.railConnections * 20 +
              b.stackPlacement.score +
              (b.plan?.overlappingRailroads.length ?? 0) * 15 -
              (a.defenseScore +
                a.railConnections * 20 +
                a.stackPlacement.score +
                (a.plan?.overlappingRailroads.length ?? 0) * 15) ||
            b.depth - a.depth,
        )
        .find(
          ({ plan, railConnections }) =>
            plan?.canBuild !== false &&
            plan?.canBuild !== undefined &&
            this.economicPlan !== undefined &&
            cityBudget.spendableGold >= Number(plan.cost) &&
            (needsPressureCity ||
              this.economicPlan.action === "stack-capacity" ||
              (this.economicPlan.action === "activate-rail" &&
                railConnections > 0)),
        );
      if (city?.plan.canBuild !== false && city?.plan.canBuild !== undefined) {
        this.eventBus.emit(
          new BuildUnitIntentEvent(UnitType.City, city.plan.canBuild),
        );
        this.nextEconomicCostRefreshTick = 0;
        this.follow(player, 7);
        this.setDecision(
          city.stackPlacement.stacked
            ? "Stack a defensive city cluster"
            : needsPressureCity
              ? "Build capacity before the enemy rush"
              : city.railConnections >= 2
                ? "Bridge the rail network with a city"
                : city.railConnections === 1
                  ? "Extend a factory rail line with a city"
                  : trapped
                    ? "Build capacity while boxed in"
                    : "Invest in troop capacity",
          city.stackPlacement.stacked
            ? `This city is placed ${city.stackPlacement.nearestCityDistance?.toFixed(1)} tiles from the nearest city, just outside the configured ${structureMinDistance}-tile structure spacing. It joins ${city.stackPlacement.nearbyCities} nearby city anchor${city.stackPlacement.nearbyCities === 1 ? "" : "s"} at depth ${city.depth}, concentrating capacity where defenses and rails can protect several cities together${needsPressureCity ? ` while advancing the ${cityCount}/${desiredCityCount} pressure target` : ""}.`
            : needsPressureCity
              ? `Enemy pressure calls for ${desiredCityCount} cities; ${cityCount} are active. This safe interior site adds capacity before a rush can turn a low-reserve front into a collapse.`
              : city.railConnections >= 2
                ? `This city connects to ${city.railConnections} usable stations within train range, turning a safe interior site into an intermediate stop between existing cities or factories.`
                : city.railConnections === 1
                  ? `This city extends an existing factory-backed rail line while adding troop capacity at a safe depth of ${city.depth} tiles.`
                  : trapped
                    ? `Neutral land and usable shoreline are both blocked. A city ${city.depth} tiles behind the nearest edge raises troop capacity so the trainer can break containment instead of wasting troops on an impossible front.`
                    : `A city ${city.depth} tiles behind the nearest edge turns saved gold into troop capacity without exposing the structure directly on the border.`,
        );
        return;
      }
    }

    if (
      this.choiceAllowed("strategic") &&
      (strikePreferred || this.strategicCapability?.canFire === true) &&
      (await this.tryStrategicStrike(player, activeNationWarIDs))
    ) {
      return;
    }
    if (
      this.choiceAllowed("naval") &&
      (await this.tryNavalControl(player, borders.borderTiles, navalSituation))
    )
      return;

    if (
      this.choiceAllowed("diplomacy") &&
      (await this.tryAlliance(
        player,
        enemies,
        enemyTiles,
        frontIntel,
        reserveRatio,
        frontPolicy.desiredAlliances,
      ))
    ) {
      return;
    }
    const openingWilderness =
      hasNeutralLand && this.game.ticks() <= 40 && player.numTilesOwned() < 250;
    if (
      this.choiceAllowed("land-attack") &&
      !openingWilderness &&
      this.tryConquerTribe(
        player,
        enemies,
        frontIntel,
        reserveRatio,
        frontPolicy.reserveFloor,
      )
    )
      return;
    if (hasNeutralLand && this.choiceAllowed("expansion")) {
      const opening = player.numTilesOwned() < 2_000;
      const wildernessGrowth = landCapacityProjection;
      const regenerationTarget = Math.max(
        player.numTilesOwned() < 500 ? 0.34 : opening ? 0.38 : 0.42,
        frontPolicy.reserveFloor - 0.05,
      );
      const launchThreshold = regenerationTarget + 0.08;
      if (reserveRatio < launchThreshold && !openingWilderness) {
        this.setDecision(
          "Regenerate near the growth sweet spot",
          `Neutral land remains, but the reserve is ${Math.round(reserveRatio * 100)}%. The next pulse waits for ${Math.round(launchThreshold * 100)}%, then lands near ${Math.round(regenerationTarget * 100)}% where troop growth is close to its researched peak.`,
        );
        return;
      }
      const nearestEnemyDistance = Math.min(
        ...[...enemies.values()].map((enemy) =>
          this.normalizedPlayerDistance(player, enemy),
        ),
        1,
      );
      const desiredPostLaunchReserve =
        regenerationTarget + (nearestEnemyDistance < 0.08 ? 0.04 : 0);
      const distanceAdjustedFraction = Math.max(
        0.08,
        Math.min(
          0.36,
          (reserveRatio - desiredPostLaunchReserve) /
            Math.max(0.01, reserveRatio),
        ),
      );
      this.eventBus.emit(new AttackRatioEvent(distanceAdjustedFraction));
      this.eventBus.emit(
        new SendAttackIntentEvent(
          null,
          Math.floor(player.troops() * distanceAdjustedFraction),
        ),
      );
      this.follow(player, 8);
      this.setDecision(
        openingWilderness
          ? "Take wilderness on tick one"
          : opening
            ? "Race for troop-producing land"
            : "Finish cheap expansion",
        `${Math.round(distanceAdjustedFraction * 100)}% takes neutral tiles as a pulse, leaving about ${Math.round(desiredPostLaunchReserve * 100)}% defending troops for near-peak regeneration${nearestEnemyDistance < 0.08 ? " and a four-point border safety margin" : ""}. ${wildernessGrowth.worthwhile ? `The projected territory adds about ${renderTroops(wildernessGrowth.capacityGain)} max troops and improves the empty-capacity regeneration multiplier to ${wildernessGrowth.regenerationMultiplier.toFixed(2)}×.` : "The pulse is still required for opening territory; capacity scaling is not yet large enough to justify a special max-troop investment."}`,
      );
      return;
    }

    if (reserveRatio < frontPolicy.reserveFloor) {
      this.setDecision(
        "Bank across multiple nation fronts",
        `The reserve is ${Math.round(reserveRatio * 100)}% of capacity across ${this.verifiedNationBorders.size} nation borders and ${activeBorderNationWarIDs.size} active bordering nation wars. ${activeNationWarIDs.size - activeBorderNationWarIDs.size} remote hostile${activeNationWarIDs.size - activeBorderNationWarIDs.size === 1 ? " remains" : "s remain"} tracked for naval or strategic handling. The shared front model requires ${Math.round(frontPolicy.reserveFloor * 100)}% before another commitment.`,
      );
      return;
    }

    if (player.numTilesOwned() < 1_600) {
      const earlyNation = [...enemies.values()]
        .filter((candidate) => candidate.type() === PlayerType.Nation)
        .sort(
          (a, b) =>
            a.troops() *
              (a.id() === this.latestCoalitionTargetId
                ? this.latestCoalitionTargetCostMultiplier
                : 1) -
            b.troops() *
              (b.id() === this.latestCoalitionTargetId
                ? this.latestCoalitionTargetCostMultiplier
                : 1),
        )[0];
      if (earlyNation !== undefined) {
        const requiredAdvantage = 1.8 * frontPolicy.advantageMultiplier;
        const earlyFraction = Math.min(
          0.58,
          Math.max(
            0,
            (reserveRatio - frontPolicy.reserveFloor) /
              Math.max(0.01, reserveRatio),
          ),
        );
        const capacity = assessAttackCapacity({
          maxTroops,
          targetTroops: earlyNation.troops(),
          requiredAdvantage,
        });
        const earlyFront = frontIntel.get(earlyNation.id());
        const estimatedConquestTicks = this.estimatedLandAttackTicks(
          player,
          earlyNation,
          earlyFraction,
          earlyFront,
          earlyNation.numTilesOwned(),
        );
        if (
          capacity.reachable &&
          (activeBorderNationWarIDs.size === 0 ||
            activeBorderNationWarIDs.has(earlyNation.id())) &&
          activeNationOffensiveIDs.size < frontPolicy.maxNationOffensives &&
          earlyFraction >= 0.3 &&
          reserveRatio >= 0.82 &&
          player.troops() >= earlyNation.troops() * requiredAdvantage &&
          estimatedConquestTicks <= 600
        ) {
          this.attack(
            player,
            earlyNation,
            earlyFraction,
            "Break early containment with an overwhelming edge",
            `Neutral land and affordable tribes are exhausted. The trainer waited for ${Math.round(reserveRatio * 100)}% reserve, a ${requiredAdvantage.toFixed(1)}× advantage, and a feasible ${estimatedConquestTicks}-tick conquest estimate before creating a nation enemy.`,
          );
          return;
        } else if (
          capacity.reachable &&
          (activeBorderNationWarIDs.size === 0 ||
            activeBorderNationWarIDs.has(earlyNation.id())) &&
          activeNationOffensiveIDs.size < frontPolicy.maxNationOffensives &&
          earlyFraction >= 0.3
        ) {
          this.follow(earlyNation, 7);
          this.setDecision(
            `Avoid an early feud with ${earlyNation.name()}`,
            `At ${player.numTilesOwned().toLocaleString()} tiles, attacking a nation would create retaliation before the economy is ready. Wait for 82% reserve, a ${requiredAdvantage.toFixed(1)}× advantage, and a full-conquest estimate no longer than 600 ticks; the current estimate is ${estimatedConquestTicks}.`,
          );
          return;
        }
      }
    }

    if (
      this.tryStartDenialAttack(
        player,
        enemies,
        enemyTiles,
        frontIntel,
        reserveRatio,
        activeBorderNationWarIDs,
        activeNationOffensiveIDs,
        frontPolicy.maxNationOffensives,
      )
    ) {
      return;
    }
    if (
      this.tryStartLandRaid(
        player,
        enemies,
        frontIntel,
        reserveRatio,
        activeBorderNationWarIDs,
        activeNationOffensiveIDs,
        frontPolicy.maxNationOffensives,
      )
    )
      return;

    if (await this.tryLaunchReserveFleet(player, enemies)) return;

    const rankedTargets = [...enemies.values()].sort((a, b) => {
      const aDensity = a.troops() / Math.max(1, a.numTilesOwned());
      const bDensity = b.troops() / Math.max(1, b.numTilesOwned());
      const aTribeFactor = a.type() === PlayerType.Bot ? 0.72 : 1;
      const bTribeFactor = b.type() === PlayerType.Bot ? 0.72 : 1;
      const aCoalitionFactor =
        a.id() === this.latestCoalitionTargetId
          ? this.latestCoalitionTargetCostMultiplier
          : 1;
      const bCoalitionFactor =
        b.id() === this.latestCoalitionTargetId
          ? this.latestCoalitionTargetCostMultiplier
          : 1;
      const aFront = frontIntel.get(a.id());
      const bFront = frontIntel.get(b.id());
      return (
        (aDensity *
          (1 + this.normalizedPlayerDistance(player, a)) *
          aTribeFactor *
          aCoalitionFactor *
          (aFront?.averageLossCost ?? 1)) /
          Math.max(1, Math.sqrt(aFront?.borderWidth ?? 1)) -
        (bDensity *
          (1 + this.normalizedPlayerDistance(player, b)) *
          bTribeFactor *
          bCoalitionFactor *
          (bFront?.averageLossCost ?? 1)) /
          Math.max(1, Math.sqrt(bFront?.borderWidth ?? 1))
      );
    });
    if (rankedTargets.length === 0) {
      this.setDecision(
        "Search for a legal front",
        "No adjacent hostile land is available; the trainer is avoiding an invalid or wasteful order.",
      );
      return;
    }

    const targetPlans = rankedTargets.map((candidate) => {
      const isNation = candidate.type() === PlayerType.Nation;
      const front = frontIntel.get(candidate.id());
      const terrainAdjustedAdvantage = terrainAdjustedAdvantageFor(
        candidate,
        front,
      );
      return {
        target: candidate,
        isNation,
        frontAllowed: nationLandFrontAllowed({
          isNation,
          targetID: candidate.id(),
          activeBorderWarIDs: activeBorderNationWarIDs,
          activeOffensiveIDs: activeNationOffensiveIDs,
          maxNationOffensives: frontPolicy.maxNationOffensives,
        }),
        front,
        terrainAdjustedAdvantage,
        capacity: assessAttackCapacity({
          maxTroops,
          targetTroops: candidate.troops(),
          requiredAdvantage: terrainAdjustedAdvantage,
        }),
      };
    });
    const targetPlan = targetPlans.find(
      (plan) => plan.capacity.reachable && plan.frontAllowed,
    );
    if (targetPlan === undefined) {
      const frontBlocked = targetPlans.find(
        (plan) => plan.capacity.reachable && !plan.frontAllowed,
      );
      if (frontBlocked !== undefined) {
        this.follow(frontBlocked.target, 6);
        this.setDecision(
          "Hold the existing nation fronts",
          `${activeNationOffensiveIDs.size} nation offensives and ${activeBorderNationWarIDs.size} active bordering wars occupy ${this.verifiedNationBorders.size} nation borders. ${activeNationWarIDs.size - activeBorderNationWarIDs.size} remote wars remain reserved for naval or strategic handling; the land policy allows ${frontPolicy.maxNationOffensives}.`,
        );
        return;
      }
      const escapeCandidates =
        this.game.ticks() < this.nextRaidTick
          ? []
          : targetPlans
              .filter((plan) => plan.frontAllowed)
              .flatMap((plan) => {
                const escape = planCapacityEscapeRaid({
                  noGrowthTicks,
                  reserveRatio,
                  reserveFloor: frontPolicy.reserveFloor,
                  incomingFronts: incomingAttacks.length,
                  outgoingFronts: player.outgoingAttacks().length,
                  requiredCapacityRatio:
                    plan.capacity.requiredTroops / Math.max(1, maxTroops),
                  terrainCost: plan.front?.averageLossCost ?? 1,
                });
                if (escape === null) return [];
                const targetGain = Math.max(
                  20,
                  Math.ceil(player.numTilesOwned() * escape.targetGainRatio),
                );
                const estimatedTicks = this.estimatedLandAttackTicks(
                  player,
                  plan.target,
                  escape.fraction,
                  plan.front,
                  targetGain,
                );
                if (estimatedTicks > escape.deadlineTicks) return [];
                const forecast = this.opponentForecasts.get(plan.target.id());
                return [
                  {
                    ...plan,
                    escape,
                    targetGain,
                    estimatedTicks,
                    forecastPenalty:
                      forecast?.predictedChoice === "attack"
                        ? forecast.threat
                        : (forecast?.threat ?? 0) * 0.25,
                  },
                ];
              })
              .sort(
                (a, b) =>
                  a.estimatedTicks +
                  a.forecastPenalty * 8 +
                  a.capacity.requiredTroops / Math.max(1, maxTroops) -
                  (b.estimatedTicks +
                    b.forecastPenalty * 8 +
                    b.capacity.requiredTroops / Math.max(1, maxTroops)),
              );
      const capacityEscape = escapeCandidates[0];
      if (capacityEscape !== undefined) {
        const { target, escape, targetGain, estimatedTicks } = capacityEscape;
        this.activeRaid = {
          targetSmallID: target.smallID(),
          targetName: target.name(),
          startTick: this.game.ticks(),
          startTiles: player.numTilesOwned(),
          targetGain,
          committedTroops: player.troops() * escape.fraction,
          targetTroopsAtStart: target.troops(),
          targetTilesAtStart: target.numTilesOwned(),
          minimumHoldTicks: 24,
          deadlineTicks: escape.deadlineTicks,
          maximumGambleTicks: escape.deadlineTicks * 2,
          purpose: "denial",
        };
        this.learning.raidAttempts++;
        this.saveLearning();
        this.attack(
          player,
          target,
          escape.fraction,
          "Break the capacity deadlock",
          `${noGrowthTicks} ticks passed without durable growth while every full conquest remained above capacity. A bounded ${Math.round(escape.fraction * 100)}% raid targets ${targetGain} tiles from ${target.name()} in about ${estimatedTicks} ticks, leaving at least ${Math.round(Math.max(0.72, frontPolicy.reserveFloor + 0.08) * 100)}% capacity protected at home.`,
        );
        return;
      }
      const blocked = targetPlans
        .slice()
        .sort(
          (a, b) =>
            a.capacity.requiredTroops / Math.max(1, maxTroops) -
            b.capacity.requiredTroops / Math.max(1, maxTroops),
        )[0];
      this.follow(blocked.target, 6);
      this.setDecision(
        `Capacity blocks ${blocked.target.name()}`,
        `This easiest legal front needs about ${renderTroops(blocked.capacity.requiredTroops)} at a ${blocked.terrainAdjustedAdvantage.toFixed(2)}× advantage, above the current ${renderTroops(maxTroops)} capacity. Capacity-city and first-factory targets now scale with the gap; a bounded raid will execute once the reserve, terrain, and ${noGrowthTicks}-tick growth stall make it survivable.`,
      );
      return;
    }

    const {
      target,
      isNation: isImpossibleNation,
      front: targetFront,
      terrainAdjustedAdvantage,
    } = targetPlan;
    const bankedTroops = desiredBankedTroops({
      maxTroops,
      enemyTroops: target.troops(),
      enemyMaxTroops: this.game.config().maxTroops(target),
      enemyFronts: Math.max(
        1,
        this.verifiedNationBorders.size + player.outgoingAttacks().length,
      ),
      reserveFloor: frontPolicy.reserveFloor,
      isTribe: !isImpossibleNation,
    });
    if (player.troops() < targetPlan.capacity.requiredTroops) {
      this.follow(target, 6);
      this.setDecision(
        `Bank against ${target.name()}`,
        `Waiting for a ${terrainAdjustedAdvantage.toFixed(2)}× troop advantage before opening this ${targetFront?.terrainLabel ?? "unknown"} front${targetFront?.defendedContactRatio ? `; ${Math.round(targetFront.defendedContactRatio * 100)}% is covered by defense posts` : ""}.`,
      );
      return;
    }

    const escapeRouteAvailable = isImpossibleNation
      ? await this.hasWeakNationEscapeRoute(player, target)
      : false;
    const baseConquestFraction = isImpossibleNation
      ? escapeRouteAvailable
        ? 0.9
        : 0.55
      : 0.38;
    const reserveLimitedFraction = Math.max(
      0,
      (reserveRatio - frontPolicy.reserveFloor) / Math.max(0.01, reserveRatio),
    );
    const conquestFraction = Math.min(
      baseConquestFraction,
      reserveLimitedFraction,
      Math.max(
        0,
        (player.troops() - bankedTroops) / Math.max(1, player.troops()),
      ),
    );
    if (conquestFraction < 0.12) {
      this.follow(target, 6);
      this.setDecision(
        "Preserve reserves across nation fronts",
        `Only ${Math.round(conquestFraction * 100)}% can be committed while retaining ${renderTroops(bankedTroops)} at home (the ${isImpossibleNation ? "attainable capture-slowdown target" : "tribe reserve target"}). ${escapeRouteAvailable ? "A weaker nation without a shared border provides an escape route." : "No weaker, non-bordering escape nation is available."}`,
      );
      return;
    }
    const estimatedConquestTicks = this.estimatedLandAttackTicks(
      player,
      target,
      conquestFraction,
      targetFront,
      target.numTilesOwned(),
    );
    if (estimatedConquestTicks > 600) {
      this.follow(target, 6);
      this.setDecision(
        `Reject an impractical conquest of ${target.name()}`,
        `The game-speed estimate is ${estimatedConquestTicks} ticks to cross ${target.numTilesOwned().toLocaleString()} tiles through this width-${targetFront?.borderWidth ?? 1} ${targetFront?.terrainLabel ?? "mixed"} front. Full attacks are capped at 600 estimated ticks; only a separately budgeted land grab may proceed.`,
      );
      return;
    }

    const maxPushRisk = assessMaxPushRisk({
      reserveRatio,
      commitFractionOfCurrent: conquestFraction,
      activeFronts: player.outgoingAttacks().length,
      defenderTroopRatio:
        target.troops() / Math.max(1, player.troops() * conquestFraction),
      takeSpeedMultiplier: conquestFraction >= 0.55 ? 2 : 1,
    });
    if (!maxPushRisk.allowed) {
      this.follow(target, 6);
      this.setDecision(
        `Avoid a risky max push on ${target.name()}`,
        `${maxPushRisk.reason}. The two-times capture speed is not worth exposing the land and losing the whole squad; the trainer will regenerate or use a smaller land grab.`,
      );
      return;
    }

    this.attack(
      player,
      target,
      conquestFraction,
      isImpossibleNation
        ? "Commit at the advantage window"
        : "Clear a weak border",
      `${Math.round(conquestFraction * 100)}% commits with an estimated ${estimatedConquestTicks}-tick path to full conquest through a width-${targetFront?.borderWidth ?? 1} ${targetFront?.terrainLabel ?? "mixed"} front.`,
    );
  }

  private attack(
    player: PlayerView,
    target: PlayerView,
    fraction: number,
    title: string,
    explanation?: string,
  ): void {
    if (!this.choiceAllowed("land-attack")) return;
    if (
      target.type() === PlayerType.Nation &&
      !this.verifiedNationBorders.has(target.id())
    ) {
      this.activeRaid = undefined;
      this.setDecision(
        `Reject non-border attack on ${target.name()}`,
        "Nation land attacks require a shared border verified during this decision. Distant expeditions are reserved for tribes.",
      );
      return;
    }
    if (target.type() === PlayerType.Nation) {
      this.hostileNationIDs.add(target.id());
    }
    this.eventBus.emit(new AttackRatioEvent(fraction));
    this.eventBus.emit(new SendTargetPlayerIntentEvent(target.id()));
    this.eventBus.emit(
      new SendAttackIntentEvent(
        target.id(),
        Math.floor(player.troops() * fraction),
      ),
    );
    this.follow(target, 6);
    this.setDecision(
      `${title}: ${target.name()}`,
      explanation ??
        `The trainer committed ${Math.round(fraction * 100)}% through the normal player targeting and attack UI.`,
    );
  }

  private async tryBuildStrategicSam(
    player: PlayerView,
    borderTiles: ReadonlySet<number>,
    structures: ReadonlyArray<ReturnType<PlayerView["units"]>[number]>,
    survival: ReturnType<typeof evaluateStrategicSurvival>,
    samCost: number,
  ): Promise<boolean> {
    if (
      !survival.buildSam ||
      samCost <= 0 ||
      this.economicPlan === undefined ||
      this.economicPlan.spendableGold < samCost
    ) {
      return false;
    }
    const existing = player.units(UnitType.SAMLauncher);
    const samRange = this.game.config().defaultSamRange();
    const mirvThreat = survival.mirvStrategy !== "ignore";
    const protectionRadius = samPlacementProtectionRadius(mirvThreat, samRange);
    const protectionRadiusSquared = protectionRadius ** 2;
    const existingCoverageByStructure = new Map(
      structures.map((structure) => [
        structure.id(),
        existing.filter(
          (sam) =>
            sam.isActive() &&
            this.game.euclideanDistSquared(structure.tile(), sam.tile()) <=
              (mirvThreat
                ? protectionRadiusSquared
                : this.game.config().samRange(sam.level()) ** 2),
        ).length,
      ]),
    );
    const candidates = this.interiorBuildCandidates(
      player,
      borderTiles,
      Math.max(14, Math.ceil(this.game.config().structureMinDist() * 2)),
    )
      .slice(0, 96)
      .map(({ tile, depth }) => {
        const covered = structures.filter(
          (structure) =>
            this.game.euclideanDistSquared(tile, structure.tile()) <=
            protectionRadiusSquared,
        );
        const protectedStructures = covered.map((structure) => ({
          type: structure.type(),
          existingCoverage:
            existingCoverageByStructure.get(structure.id()) ?? 0,
        }));
        const nearestSamDistance =
          existing.length === 0
            ? Number.POSITIVE_INFINITY
            : Math.sqrt(
                Math.min(
                  ...existing.map((sam) =>
                    this.game.euclideanDistSquared(tile, sam.tile()),
                  ),
                ),
              );
        const placement = scoreSamPlacement({
          protectedStructures,
          depth,
          isShore: this.game.isShore(tile),
          nearestSamDistance,
          samRange,
        });
        return {
          tile,
          depth,
          covered: protectedStructures.length,
          newlyCovered: placement.newlyCovered,
          layered: placement.layered,
          score: placement.score,
        };
      })
      .filter((candidate) => candidate.covered > 0)
      .sort((a, b) => b.score - a.score);
    const selected = candidates[0];
    if (selected === undefined) return false;
    const plan = (
      await player.buildables(selected.tile, [UnitType.SAMLauncher])
    )[0];
    if (
      plan?.canBuild === false ||
      plan?.canBuild === undefined ||
      Number(plan.cost) > this.economicPlan.spendableGold
    ) {
      return false;
    }
    this.eventBus.emit(
      new BuildUnitIntentEvent(UnitType.SAMLauncher, plan.canBuild),
    );
    this.nextEconomicCostRefreshTick = 0;
    this.follow(player, 7);
    this.setDecision(
      "Build layered SAM coverage",
      `This launcher covers ${selected.covered} critical structure${selected.covered === 1 ? "" : "s"}: ${selected.newlyCovered} gain first coverage and ${selected.layered} gain another interception layer from depth ${selected.depth}${mirvThreat ? `, using the MIRV warhead protection radius of ${protectionRadius} tiles` : ""}. ${survival.reason}.`,
    );
    return true;
  }

  private async tryBuildStrategicSilo(
    player: PlayerView,
    borderTiles: ReadonlySet<number>,
    capability: StrategicCapabilityPlan | undefined,
    siloCost: number,
  ): Promise<boolean> {
    if (
      capability?.shouldBuildSilo !== true ||
      siloCost <= 0 ||
      this.economicPlan === undefined ||
      this.economicPlan.spendableGold < siloCost
    ) {
      return false;
    }

    const silos = player.units(UnitType.MissileSilo);
    const defensePosts = player.units(UnitType.DefensePost);
    const sams = player.units(UnitType.SAMLauncher);
    const maximumDepth = Math.max(
      30,
      Math.ceil(this.game.config().structureMinDist() * 4),
    );
    const interior = this.interiorBuildCandidates(
      player,
      borderTiles,
      maximumDepth,
    );
    const deepest = interior[0]?.depth ?? 0;
    if (deepest === 0) {
      this.lastStrategicStatus = "no interior tile is deep enough for a silo";
      return false;
    }

    const minimumDepth = Math.max(
      this.game.config().structureMinDist(),
      Math.floor(deepest * 0.65),
    );
    const candidates = interior
      .filter(({ depth }) => depth >= minimumDepth)
      .slice(0, 64)
      .map(({ tile, depth }) => {
        const nearestSiloDistance =
          silos.length === 0
            ? maximumDepth
            : Math.min(
                ...silos.map((silo) =>
                  Math.sqrt(this.game.euclideanDistSquared(tile, silo.tile())),
                ),
              );
        const defenseCoverage = defensePosts.some(
          (post) =>
            this.game.euclideanDistSquared(tile, post.tile()) <=
            this.game.config().defensePostRange() ** 2,
        );
        const samCoverage = sams.some(
          (sam) =>
            this.game.euclideanDistSquared(tile, sam.tile()) <=
            this.game.config().samRange(sam.level()) ** 2,
        );
        return {
          tile,
          depth,
          score:
            depth * 12 +
            Math.min(maximumDepth * 2, nearestSiloDistance) * 3 +
            (defenseCoverage ? 90 : 0) +
            (samCoverage ? 60 : 0) -
            (this.game.isShore(tile) ? 35 : 0),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    const plans = await Promise.all(
      candidates.map(async (candidate) => ({
        ...candidate,
        plan: (
          await player.buildables(candidate.tile, [UnitType.MissileSilo])
        )[0],
      })),
    );
    const selected = plans.find(
      ({ plan }) =>
        plan?.canBuild !== false &&
        plan?.canBuild !== undefined &&
        Number(plan.cost) <= this.economicPlan!.spendableGold,
    );
    if (
      selected?.plan.canBuild === false ||
      selected?.plan.canBuild === undefined
    ) {
      this.lastStrategicStatus = "no legal protected interior silo placement";
      return false;
    }

    this.eventBus.emit(
      new BuildUnitIntentEvent(UnitType.MissileSilo, selected.plan.canBuild),
    );
    this.nextEconomicCostRefreshTick = 0;
    this.strategicSiloBuilds++;
    this.lastStrategicStatus = `building silo ${silos.length + 1}/${capability.desiredSilos}`;
    this.follow(player, 7);
    this.setDecision(
      "Build protected strategic launch capacity",
      `Silo ${silos.length + 1}/${capability.desiredSilos} is placed at depth ${selected.depth}, with ${Math.round(this.economicPlan.spendableGold).toLocaleString()} disposable gold. ${capability.reason}.`,
    );
    return true;
  }

  private async tryStrategicStrike(
    player: PlayerView,
    activeNationWarIDs: ReadonlySet<string>,
  ): Promise<boolean> {
    const tick = this.game.ticks();
    const ticksSinceLastStrike = tick - this.lastStrategicStrikeTick;
    if (ticksSinceLastStrike < STRATEGIC_STRIKE_COOLDOWN_TICKS) return false;
    const readySilos = player
      .units(UnitType.MissileSilo)
      .filter(
        (silo) =>
          silo.isActive() &&
          !silo.isUnderConstruction() &&
          !silo.isInCooldown(),
      );
    if (readySilos.length === 0) {
      this.lastStrategicStatus = "all silo launch slots are reloading";
      return false;
    }
    const readyLaunchSlots = countReadySiloSlots(
      readySilos.map((silo) => ({
        level: silo.level(),
        reloading: silo.missileTimerQueue().length,
      })),
    );
    if (readyLaunchSlots === 0) {
      this.lastStrategicStatus = "no loaded missile slot";
      return false;
    }

    const strategicTargetTypes = [
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
      UnitType.MissileSilo,
      UnitType.SAMLauncher,
      UnitType.DefensePost,
    ] as const;
    const structureValue = (type: UnitType, level: number): number => {
      const multiplier =
        type === UnitType.MissileSilo
          ? 18
          : type === UnitType.SAMLauncher
            ? 14
            : type === UnitType.Factory
              ? 12
              : type === UnitType.City
                ? 10
                : type === UnitType.Port
                  ? 8
                  : 5;
      return multiplier * Math.max(1, level);
    };
    const targets = this.game
      .players()
      .filter(
        (candidate) =>
          candidate.isAlive() &&
          !player.isFriendly(candidate) &&
          candidate.type() !== PlayerType.Bot &&
          candidate.units(...strategicTargetTypes).length > 0,
      );
    if (targets.length === 0) {
      this.lastStrategicStatus = "no hostile strategic structures";
      this.strategicCandidateCount = 0;
      return false;
    }

    const hydrogenRadius = this.game
      .config()
      .nukeMagnitudes(UnitType.HydrogenBomb).outer;
    const aimCandidates = targets
      .flatMap((target) => {
        const forecast = this.opponentForecasts.get(target.id());
        const targetPressure =
          target.troops() / Math.max(1, this.game.config().maxTroops(target)) +
          Math.min(2, forecast?.threat ?? 0) +
          (activeNationWarIDs.has(target.id()) ? 1 : 0);
        return target
          .units(...strategicTargetTypes)
          .filter((unit) => unit.isActive())
          .map((unit) => {
            const localStructureValue = this.game
              .nearbyUnits(
                unit.tile(),
                hydrogenRadius,
                [...strategicTargetTypes],
                ({ unit: nearby }) => nearby.owner() === target,
              )
              .reduce(
                (sum, nearby) =>
                  sum + structureValue(nearby.unit.type(), nearby.unit.level()),
                0,
              );
            return {
              target,
              tile: unit.tile(),
              localStructureValue,
              quickScore:
                localStructureValue +
                targetPressure * 16 +
                structureValue(unit.type(), unit.level()),
            };
          });
      })
      .sort((a, b) => b.quickScore - a.quickScore);
    const uniqueAimCandidates = [
      ...new Map(
        aimCandidates.map((candidate) => [
          `${candidate.target.id()}:${candidate.tile}`,
          candidate,
        ]),
      ).values(),
    ];
    const candidateLimit = Math.min(
      32,
      Math.max(8, Math.ceil(Math.sqrt(uniqueAimCandidates.length) * 4)),
    );
    const candidates = uniqueAimCandidates.slice(0, candidateLimit);
    this.strategicCandidateCount = candidates.length;

    const friendlyPlayers = this.game
      .players()
      .filter(
        (candidate) =>
          candidate.isAlive() &&
          candidate !== player &&
          player.isFriendly(candidate),
      );
    const alliedSmallIDs = new Set(
      friendlyPlayers.map((candidate) => candidate.smallID()),
    );
    let best:
      | {
          target: PlayerView;
          tile: number;
          type: PlayerBuildableUnitType;
          planTile: number;
          score: number;
          expectedTroopLoss: number;
          affectedTargetTiles: number;
          destroyedStructureValue: number;
          route: NonNullable<
            ReturnType<VisualAiTrainer["strategicRouteAssessment"]>
          >;
          reasons: string[];
        }
      | undefined;
    const spendableGold = Math.max(
      0,
      this.economicPlan?.spendableGold ?? Number(player.gold()),
    );
    for (const aim of candidates) {
      const { target, tile: strikeTile } = aim;
      const route = this.strategicRouteAssessment(player, strikeTile);
      if (route === undefined) continue;
      if (route.blocked) {
        this.strategicRouteRejections++;
        continue;
      }

      const weaponCandidates: ReadonlyArray<{
        kind: "nuke";
        type: PlayerBuildableUnitType;
      }> = [
        { kind: "nuke", type: UnitType.AtomBomb },
        { kind: "nuke", type: UnitType.HydrogenBomb },
      ];
      const buildables = await player.buildables(
        strikeTile,
        weaponCandidates.map(({ type }) => type),
      );
      for (const [index, candidate] of weaponCandidates.entries()) {
        const plan = buildables[index];
        if (
          plan?.canBuild === false ||
          plan?.canBuild === undefined ||
          Number(player.gold()) < Number(plan.cost) ||
          spendableGold < Number(plan.cost)
        ) {
          continue;
        }

        const magnitude = this.game.config().nukeMagnitudes(candidate.type);
        const blastCounts = computeNukeBlastCounts({
          gm: this.game,
          targetTile: strikeTile,
          magnitude,
        });
        const ownCollateralTiles = blastCounts.get(player.smallID()) ?? 0;
        const alliedCollateralTiles = [...alliedSmallIDs].reduce(
          (sum, smallID) => sum + (blastCounts.get(smallID) ?? 0),
          0,
        );
        const thirdPartyCollateralTiles = [...blastCounts.entries()].reduce(
          (sum, [smallID, affectedTiles]) =>
            smallID !== player.smallID() &&
            smallID !== target.smallID() &&
            !alliedSmallIDs.has(smallID)
              ? sum + affectedTiles
              : sum,
          0,
        );
        let ownUnitsAtRisk = 0;
        let alliedUnitsAtRisk = 0;
        let destroyedStructureValue = 0;
        const outerSquared = magnitude.outer ** 2;
        for (const unit of this.game.units()) {
          if (
            this.game.euclideanDistSquared(strikeTile, unit.tile()) >=
            outerSquared
          ) {
            continue;
          }
          if (unit.owner().smallID() === player.smallID()) {
            ownUnitsAtRisk++;
          } else if (alliedSmallIDs.has(unit.owner().smallID())) {
            alliedUnitsAtRisk++;
          } else if (
            unit.owner() === target &&
            strategicTargetTypes.includes(
              unit.type() as (typeof strategicTargetTypes)[number],
            )
          ) {
            destroyedStructureValue += structureValue(
              unit.type(),
              unit.level(),
            );
          }
        }

        const affectedTargetTiles = blastCounts.get(target.smallID()) ?? 0;
        const expectedTroopLoss = estimateConventionalNukeTroopLoss({
          troops: target.troops(),
          totalTiles: target.numTilesOwned(),
          affectedTiles: affectedTargetTiles,
        });
        const decision = assessStrategicStrike({
          weapon: candidate.kind,
          targetTroops: target.troops(),
          targetStructures: target.units(...strategicTargetTypes).length,
          targetTerritoryShare:
            affectedTargetTiles / Math.max(1, target.numTilesOwned()),
          targetActiveWars:
            target.incomingAttacks().length + target.outgoingAttacks().length,
          targetHasSamCoverage: route.interceptionCapacity > 0,
          targetIsWinning:
            target.numTilesOwned() > player.numTilesOwned() * 1.4,
          targetIsAlly: player.isFriendly(target),
          ownReserveRatio:
            player.troops() / Math.max(1, this.game.config().maxTroops(player)),
          ownActiveNationWars: activeNationWarIDs.size,
          availableWeapons: readyLaunchSlots,
          ticksSinceLastStrike,
          ownCollateralTiles,
          alliedCollateralTiles,
          ownUnitsAtRisk,
          alliedUnitsAtRisk,
          expectedTroopLoss,
          affectedTargetTiles,
          targetTotalTiles: target.numTilesOwned(),
          destroyedStructureValue,
          thirdPartyCollateralTiles,
          pathBlocked: route.blocked,
          samInterceptionCapacity: route.interceptionCapacity,
          requiredSalvoSize: route.interceptionCapacity + 1,
          weaponCost: Number(plan.cost),
          spendableGold,
        });
        if (!decision.fire) {
          if (
            ownCollateralTiles > 0 ||
            alliedCollateralTiles > 0 ||
            ownUnitsAtRisk > 0 ||
            alliedUnitsAtRisk > 0 ||
            thirdPartyCollateralTiles > 0
          ) {
            this.strategicCollateralRejections++;
          }
          continue;
        }
        if (best === undefined || decision.score > best.score) {
          best = {
            target,
            tile: strikeTile,
            type: candidate.type,
            planTile: plan.canBuild,
            score: decision.score,
            expectedTroopLoss,
            affectedTargetTiles,
            destroyedStructureValue,
            route,
            reasons: decision.reasons,
          };
        }
      }
    }
    if (best === undefined) {
      this.lastStrategicStatus = `${candidates.length} local target candidates evaluated; none cleared path, collateral, SAM, and value checks`;
      return false;
    }

    // buildables() returns the launch silo in canBuild, while this intent must
    // carry the evaluated strike destination.
    this.eventBus.emit(new BuildUnitIntentEvent(best.type, best.tile));
    this.lastStrategicStrikeTick = tick;
    this.strategicLaunches++;
    this.lastStrategicTarget = best.target.name();
    this.lastStrategicWeapon = best.type;
    this.lastStrategicScore = best.score;
    this.lastStrategicStatus = "launch intent accepted by strategic planner";
    this.pendingStrategicStrike = {
      targetSmallID: best.target.smallID(),
      targetName: best.target.name(),
      targetTroops: best.target.troops(),
      targetTiles: best.target.numTilesOwned(),
      targetStructures: best.target
        .units(...strategicTargetTypes)
        .filter((unit) => unit.isActive()).length,
      evaluateTick: tick + best.route.flightTicks + 20,
    };
    this.follow(best.target, 7);
    this.setDecision(
      `Fire ${best.type} at ${best.target.name()}`,
      `The selected blast is expected to remove ${renderTroops(best.expectedTroopLoss)}, affect ${Math.round(best.affectedTargetTiles)} weighted tiles, and hit ${best.destroyedStructureValue.toFixed(0)} structure-value points. The exact parabolic route uses ${best.route.sourceLabel}, crosses ${best.route.interceptingSams} loaded SAM launcher${best.route.interceptingSams === 1 ? "" : "s"}, and scored ${best.score.toFixed(1)} after cost and collateral. ${best.reasons.join("; ") || "all launch checks passed"}.`,
    );
    return true;
  }

  private strategicRouteAssessment(player: PlayerView, destination: number) {
    const silos = player
      .units(UnitType.MissileSilo)
      .filter(
        (silo) =>
          silo.isActive() &&
          !silo.isUnderConstruction() &&
          !silo.isInCooldown(),
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), destination) -
          this.game.manhattanDist(b.tile(), destination),
      );
    const sourceSilo = silos[0];
    if (sourceSilo === undefined) return undefined;
    const source = sourceSilo.tile();
    const path =
      UniversalPathFinding.Parabola(this.game, {
        increment: this.game.config().nukeSpeed(UnitType.AtomBomb),
        distanceBasedHeight: true,
        directionUp: true,
      }).findPath(source, destination) ?? [];
    const hostileSams = this.game
      .units(UnitType.SAMLauncher)
      .filter(
        (sam) =>
          sam.isActive() &&
          !sam.isUnderConstruction() &&
          sam.owner() !== player &&
          !player.isFriendly(sam.owner()) &&
          sam.level() - sam.missileTimerQueue().length > 0,
      );
    const assessment = assessStrategicRoute({
      path: path.map((tile) => ({
        x: this.game.x(tile),
        y: this.game.y(tile),
        blocked: this.game.isImpassable(tile),
      })),
      source: { x: this.game.x(source), y: this.game.y(source) },
      destination: {
        x: this.game.x(destination),
        y: this.game.y(destination),
      },
      targetableRange: this.game.config().defaultNukeTargetableRange(),
      sams: hostileSams.map((sam) => ({
        id: sam.id(),
        x: this.game.x(sam.tile()),
        y: this.game.y(sam.tile()),
        range: this.game.config().samRange(sam.level()),
        availableInterceptions: sam.level() - sam.missileTimerQueue().length,
      })),
    });
    return {
      ...assessment,
      flightTicks: Math.max(1, path.length),
      source,
      sourceLabel: `level-${sourceSilo.level()} silo at ${this.game.x(source)},${this.game.y(source)}`,
    };
  }

  private async tryBuildEmergencyCity(
    player: PlayerView,
    borderTiles: ReadonlySet<number>,
    context: {
      enemyFronts: number;
      activeWars: number;
      incomingFronts: number;
      reserveRatio: number;
      incomingTroops: number;
      nationFronts: Array<{
        contactTile: number;
        troops: number;
        maxTroops: number;
      }>;
    },
  ): Promise<boolean> {
    const currentMaxTroops = Math.max(1, this.game.config().maxTroops(player));

    const cities = player.units(UnitType.City);
    const desiredCities = desiredDefensiveCityCount({
      enemyFronts: context.enemyFronts,
      activeWars: context.activeWars,
      incomingFronts: context.incomingFronts,
      ownedCities: cities.length,
      ownedTiles: player.numTilesOwned(),
      reserveRatio: context.reserveRatio,
      incomingTroopRatio: context.incomingTroops / currentMaxTroops,
    });
    if (
      !shouldTriggerEmergencyCity({
        tick: this.game.ticks(),
        nextAttemptTick: this.nextEmergencyCityTick,
        incomingTroops: context.incomingTroops,
        maxTroops: currentMaxTroops,
        reserveRatio: context.reserveRatio,
        currentCities: cities.length,
        desiredCities,
      })
    ) {
      return false;
    }

    const terrainProfile = (tile: number): { label: string; value: number } => {
      switch (this.game.terrainType(tile)) {
        case TerrainType.Mountain:
          return { label: "mountain", value: 80 };
        case TerrainType.Highland:
          return { label: "highland", value: 45 };
        case TerrainType.Plains:
          return { label: "plains", value: 0 };
        default:
          return { label: "invalid", value: -100 };
      }
    };
    const structureMinDistance = this.game.config().structureMinDist();
    const interiorCandidates = this.interiorBuildCandidates(
      player,
      borderTiles,
      Math.max(16, Math.ceil(structureMinDistance * 2)),
    ).filter(({ depth, tile }) => depth >= 3 && this.game.isLand(tile));
    const emergencyCandidatePool = new Map<
      number,
      { tile: number; depth: number }
    >();
    for (const candidate of interiorCandidates.slice(0, 128)) {
      emergencyCandidatePool.set(candidate.tile, candidate);
    }
    const stackRadiusSquared = (structureMinDistance * 2.25) ** 2;
    const minimumStackDistanceSquared = (structureMinDistance * 0.95) ** 2;
    for (const candidate of interiorCandidates) {
      if (
        emergencyCandidatePool.size < 256 &&
        cities.some((city) => {
          const distance = this.game.euclideanDistSquared(
            candidate.tile,
            city.tile(),
          );
          return (
            distance >= minimumStackDistanceSquared &&
            distance <= stackRadiusSquared
          );
        })
      ) {
        emergencyCandidatePool.set(candidate.tile, candidate);
      }
    }
    const candidates = [...emergencyCandidatePool.values()]
      .map(({ tile, depth }) => {
        const terrain = terrainProfile(tile);
        const passableExits = this.game
          .neighbors(tile)
          .filter(
            (neighbor) =>
              this.game.isLand(neighbor) && !this.game.isImpassable(neighbor),
          ).length;
        const chokeValue = Math.max(0, 6 - passableExits) * 14;
        const nationPressure = context.nationFronts.reduce((best, front) => {
          const distance = Math.sqrt(
            this.game.euclideanDistSquared(tile, front.contactTile),
          );
          const strength = front.troops / Math.max(1, front.maxTroops);
          return Math.max(best, (strength * 120) / (1 + distance / 50));
        }, 0);
        const stackPlacement = scoreCityStackPlacement({
          cityDistancesSquared: cities.map((city) =>
            this.game.euclideanDistSquared(tile, city.tile()),
          ),
          structureMinDistance,
        });
        return {
          tile,
          depth,
          terrainLabel: terrain.label,
          passableExits,
          stackPlacement,
          score:
            terrain.value +
            chokeValue +
            nationPressure +
            stackPlacement.score +
            Math.min(12, depth) * 3,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    const plans = await Promise.all(
      candidates.map(async (candidate) => {
        const plan = (
          await player.buildables(candidate.tile, [UnitType.City])
        )[0];
        const actualTile =
          plan?.canBuild === false || plan?.canBuild === undefined
            ? candidate.tile
            : plan.canBuild;
        const stackPlacement = scoreCityStackPlacement({
          cityDistancesSquared: cities.map((city) =>
            this.game.euclideanDistSquared(actualTile, city.tile()),
          ),
          structureMinDistance,
        });
        return {
          ...candidate,
          stackPlacement,
          score:
            candidate.score -
            candidate.stackPlacement.score +
            stackPlacement.score,
          plan,
        };
      }),
    );
    const city = plans
      .filter(
        ({ plan }) =>
          plan?.canBuild !== false &&
          plan?.canBuild !== undefined &&
          player.gold() >= plan.cost,
      )
      .sort(
        (a, b) =>
          b.score +
          (b.plan?.overlappingRailroads.length ?? 0) * 15 -
          (a.score + (a.plan?.overlappingRailroads.length ?? 0) * 15),
      )[0];
    if (city?.plan?.canBuild === false || city?.plan?.canBuild === undefined) {
      return false;
    }

    this.eventBus.emit(
      new BuildUnitIntentEvent(UnitType.City, city.plan.canBuild),
    );
    this.nextEconomicCostRefreshTick = 0;
    // One turn is enough for the build intent to enter unit state. The former
    // 150-tick cooldown prevented a collapsing nation from stacking the
    // additional cities its newly increased pressure target called for.
    this.nextEmergencyCityTick = this.game.ticks() + 1;
    this.follow(player, 7);
    this.setDecision(
      "Build an emergency defensive city",
      `City ${cities.length + 1}/${desiredCities} is anchored ${city.depth} tiles inside on ${city.terrainLabel} terrain with ${city.passableExits} passable exits near the most relevant nation front${city.stackPlacement.stacked ? `, stacked ${city.stackPlacement.nearestCityDistance?.toFixed(1)} tiles from its nearest city anchor` : ""}. Bordering-nation strength, city-cluster geometry, chokepoints, and rail overlap contribute to its ${city.score.toFixed(1)} defense score.`,
    );
    return true;
  }

  private async tryBuildDefensePost(
    player: PlayerView,
    incoming: ReturnType<PlayerView["incomingAttacks"]>,
    threateningNations: readonly PlayerView[] = [],
    knownBorders?: Awaited<ReturnType<PlayerView["borderTiles"]>>,
  ): Promise<boolean> {
    const totalIncoming = incoming.reduce(
      (sum, attack) => sum + attack.troops,
      0,
    );
    const proactive = incoming.length === 0 && threateningNations.length > 0;
    const projectedIncoming = proactive
      ? Math.max(...threateningNations.map((nation) => nation.troops()))
      : totalIncoming;
    const pressureRatio = projectedIncoming / Math.max(1, player.troops());
    if (!proactive && pressureRatio < 0.35) return false;

    const defenseRange = this.game.config().defensePostRange();
    const attackerIDs = new Set([
      ...incoming.map((attack) => attack.attackerID),
      ...threateningNations.map((nation) => nation.smallID()),
    ]);
    const pushingThisFront = player
      .outgoingAttacks()
      .some((attack) => attackerIDs.has(attack.targetID));
    const canCreateLandBuffer =
      pushingThisFront || player.troops() >= projectedIncoming * 1.2;
    const minimumSafeDepth = minimumDefensePostDepth(
      canCreateLandBuffer,
      defenseRange,
    );

    const borders = knownBorders ?? (await player.borderTiles());
    const rawCandidates = this.interiorBuildCandidates(
      player,
      borders.borderTiles,
      Math.max(6, defenseRange),
    ).filter(({ depth }) => depth >= minimumSafeDepth);
    if (rawCandidates.length === 0) return false;

    // Keep placement cost bounded in large late-game territories. The
    // candidates are already depth-sorted, so sample across the full
    // legal set rather than repeatedly evaluating the same deep corner.
    const sampleLimit = 192;
    const sampledCandidates =
      rawCandidates.length <= sampleLimit
        ? rawCandidates
        : Array.from(
            { length: sampleLimit },
            (_, index) =>
              rawCandidates[
                Math.floor(
                  (index * (rawCandidates.length - 1)) /
                    Math.max(1, sampleLimit - 1),
                )
              ],
          );

    // Defense-post effects do not stack. Reject overlapping post radii
    // through the spatial UnitGrid, then score only the land covered by
    // this candidate's own radius. Buildings never enter this search.
    const minimumPostSpacing = defenseRange * 2;
    const minimumPostSpacingSquared = minimumPostSpacing ** 2;
    const candidates = sampledCandidates
      .flatMap(({ tile, depth }) => {
        const overlapsDefense = this.game
          .nearbyUnits(
            tile,
            minimumPostSpacing,
            [UnitType.DefensePost],
            ({ unit }) => unit.owner() === player,
          )
          .some(({ distSquared }) => distSquared < minimumPostSpacingSquared);
        if (overlapsDefense) return [];

        const ownedCoverage = this.game.circleSearch(
          tile,
          defenseRange,
          (coveredTile) =>
            this.game.isLand(coveredTile) &&
            this.game.hasOwner(coveredTile) &&
            this.game.owner(coveredTile) === player,
        ).size;
        if (ownedCoverage === 0) return [];

        return [{ tile, depth, ownedCoverage }];
      })
      .sort((a, b) => b.ownedCoverage - a.ownedCoverage || b.depth - a.depth)
      .slice(0, 6);

    const plans = await Promise.all(
      candidates.map(async ({ tile, depth, ownedCoverage }) => ({
        depth,
        ownedCoverage,
        plan: (await player.buildables(tile, [UnitType.DefensePost]))[0],
      })),
    );
    const defense = plans.find(
      ({ plan }) =>
        plan?.canBuild !== false &&
        plan?.canBuild !== undefined &&
        player.gold() >= plan.cost,
    );
    if (
      defense?.plan.canBuild === false ||
      defense?.plan.canBuild === undefined
    ) {
      return false;
    }

    this.eventBus.emit(
      new BuildUnitIntentEvent(UnitType.DefensePost, defense.plan.canBuild),
    );
    this.nextEconomicCostRefreshTick = 0;
    this.nextDecisionTick = this.game.ticks() + 1;
    this.follow(player, 7);
    this.setDecision(
      proactive
        ? "Pre-fortify owned land"
        : canCreateLandBuffer
          ? "Fortify behind an advancing front"
          : "Fortify safely behind the border",
      `${proactive ? `${renderTroops(projectedIncoming)} is the maximum visible home force across ${threateningNations.length} bordering nation${threateningNations.length === 1 ? "" : "s"}. ` : `${renderTroops(totalIncoming)} crossed this front. `}The post is placed ${defense.depth} tiles inside and its own radius covers ${defense.ownedCoverage.toLocaleString()} owned tiles without overlapping another defense post.`,
    );
    return true;
  }

  private ensureAllyCooperationRecord(
    other: PlayerView,
    allianceCreatedAt: number,
  ): AllyCooperationRecord {
    const existing = this.allyCooperation.get(other.id());
    if (
      existing !== undefined &&
      existing.allianceCreatedAt === allianceCreatedAt
    ) {
      return existing;
    }
    const record: AllyCooperationRecord = {
      allianceCreatedAt,
      requestsSent: 0,
      requestsAnswered: 0,
      ignoredRequests: 0,
      sharedFrontSamples: 0,
      sharedFrontResponses: 0,
      unpromptedAidEvents: 0,
      receivedGold: 0,
      receivedTroops: 0,
      lastObservedTick: Number.NEGATIVE_INFINITY,
      lastRequestTick: Number.NEGATIVE_INFINITY,
      lastMessageTick: Number.NEGATIVE_INFINITY,
      lastThanksTick: Number.NEGATIVE_INFINITY,
      lastAidTick: Number.NEGATIVE_INFINITY,
      lastDonationTick: Number.NEGATIVE_INFINITY,
    };
    this.allyCooperation.set(other.id(), record);
    return record;
  }

  private assessAllyCooperation(
    record: AllyCooperationRecord,
  ): AllianceCooperationAssessment {
    return assessAllianceCooperation({
      requestsAnswered: record.requestsAnswered,
      ignoredRequests: record.ignoredRequests,
      sharedFrontSamples: record.sharedFrontSamples,
      sharedFrontResponses: record.sharedFrontResponses,
      unpromptedAidEvents: record.unpromptedAidEvents,
      allianceAgeRatio:
        (this.game.ticks() - record.allianceCreatedAt) /
        Math.max(1, this.game.config().allianceDuration()),
    });
  }

  private resolveAllyRequest(record: AllyCooperationRecord): void {
    if (record.pending === undefined) return;
    record.requestsAnswered++;
    record.pending = undefined;
  }

  private observeAllianceCooperation(player: PlayerView): void {
    const tick = this.game.ticks();
    const activeAllies = new Set<string>();
    for (const alliance of player.alliances()) {
      const other = this.game.player(alliance.other);
      if (!other.isAlive()) continue;
      activeAllies.add(other.id());
      this.ensureAllyCooperationRecord(other, alliance.createdAt);
    }
    for (const id of this.allyCooperation.keys()) {
      if (!activeAllies.has(id)) this.allyCooperation.delete(id);
    }

    for (const update of this.game.updatesSinceLastTick()?.[
      GameUpdateType.DonateEvent
    ] ?? []) {
      if (update.recipientId !== player.id() || update.amount <= 0n) continue;
      const other = this.game.player(update.senderId);
      if (!player.isFriendly(other)) continue;
      const alliance = player
        .alliances()
        .find((candidate) => candidate.other === other.id());
      if (alliance === undefined) continue;
      const record = this.ensureAllyCooperationRecord(
        other,
        alliance.createdAt,
      );
      if (update.donationType === "gold") {
        record.receivedGold += Number(update.amount);
      } else {
        record.receivedTroops += Number(update.amount);
      }
      record.lastAidTick = tick;
      if (record.pending?.kind === "aid") {
        this.resolveAllyRequest(record);
      } else {
        record.unpromptedAidEvents++;
      }
    }

    const responseWindow = allianceResponseWindowTicks({
      quickChatCooldownTicks: this.game.config().quickChatCooldown(),
      allianceDurationTicks: this.game.config().allianceDuration(),
    });
    const ownWarTargets = new Set<number>([
      ...player
        .incomingAttacks()
        .filter((attack) => !attack.retreating)
        .map((attack) => attack.attackerID),
      ...player
        .outgoingAttacks()
        .filter((attack) => !attack.retreating)
        .map((attack) => attack.targetID),
    ]);
    const assessments: AllianceCooperationAssessment[] = [];
    for (const alliance of player.alliances()) {
      const other = this.game.player(alliance.other);
      if (!other.isAlive()) continue;
      const record = this.ensureAllyCooperationRecord(
        other,
        alliance.createdAt,
      );
      if (
        tick - record.lastObservedTick >=
        this.game.config().quickChatCooldown()
      ) {
        record.lastObservedTick = tick;
        const sharedPressure = other
          .outgoingAttacks()
          .some(
            (attack) =>
              !attack.retreating && ownWarTargets.has(attack.targetID),
          );
        if (sharedPressure) {
          record.sharedFrontSamples++;
          record.sharedFrontResponses++;
        }
      }
      if (
        record.pending?.kind === "focus" &&
        record.pending.targetSmallID !== undefined &&
        other
          .outgoingAttacks()
          .some(
            (attack) =>
              !attack.retreating &&
              attack.targetID === record.pending?.targetSmallID,
          )
      ) {
        this.resolveAllyRequest(record);
      } else if (
        record.pending !== undefined &&
        tick - record.pending.sentTick >= responseWindow
      ) {
        record.ignoredRequests++;
        record.pending = undefined;
      }
      assessments.push(this.assessAllyCooperation(record));
    }
    this.latestAllyReliability =
      assessments.length === 0
        ? 0.5
        : assessments.reduce(
            (sum, assessment) => sum + assessment.reliability,
            0,
          ) / assessments.length;
    this.latestTrustedAllies = assessments.filter(
      (assessment) => assessment.trusted,
    ).length;
  }

  private async tryCoordinateWithAllies(
    player: PlayerView,
    reserveFloor: number,
    activeNationWars: number,
    borderingPlayers: ReadonlyMap<string, PlayerView>,
  ): Promise<boolean> {
    const tick = this.game.ticks();
    const ownMaxTroops = Math.max(1, this.game.config().maxTroops(player));
    const incomingTroops = player
      .incomingAttacks()
      .filter((attack) => !attack.retreating)
      .reduce((sum, attack) => sum + attack.troops, 0);
    const allies = player
      .alliances()
      .map((alliance) => {
        const other = this.game.player(alliance.other);
        if (!other.isAlive()) return undefined;
        const record = this.ensureAllyCooperationRecord(
          other,
          alliance.createdAt,
        );
        return {
          other,
          record,
          assessment: this.assessAllyCooperation(record),
        };
      })
      .filter(
        (entry): entry is NonNullable<typeof entry> => entry !== undefined,
      );
    if (allies.length === 0) {
      this.latestCoalitionTargetId = undefined;
      this.latestCoalitionTargetCostMultiplier = 1;
      this.latestCoalitionTarget = undefined;
      this.latestCoalitionHelpers = 0;
      this.latestCoalitionTreatyBlocks = 0;
      return false;
    }
    const coordinationInterval = Math.min(
      this.game.config().donateCooldown(),
      allianceResponseWindowTicks({
        quickChatCooldownTicks: this.game.config().quickChatCooldown(),
        allianceDurationTicks: this.game.config().allianceDuration(),
      }),
    );
    const urgentOwnRequest =
      incomingTroops > 0 &&
      allies.some(
        ({ record, assessment }) =>
          assessment.trusted &&
          record.pending === undefined &&
          tick - record.lastRequestTick >= DIPLOMACY_MESSAGE_COOLDOWN_TICKS,
      );
    const urgentAllySupport = allies.some(
      ({ other, record, assessment }) =>
        assessment.trusted &&
        tick - record.lastDonationTick >= this.game.config().donateCooldown() &&
        (other.incomingAttacks().some((attack) => !attack.retreating) ||
          other.outgoingAttacks().some((attack) => !attack.retreating)),
    );
    if (
      tick < this.nextAllianceCoordinationTick &&
      !urgentOwnRequest &&
      !urgentAllySupport
    ) {
      return false;
    }
    this.nextAllianceCoordinationTick = tick + coordinationInterval;

    const allyReachability = new Map(
      await Promise.all(
        allies.map(async ({ other }) => {
          const borders = await other.borderTiles();
          const targetIDs = new Set<number>();
          let hasNeutralLand = false;
          for (const border of borders.borderTiles) {
            for (const neighbor of this.game.neighbors(border)) {
              if (!this.game.isLand(neighbor)) continue;
              if (!this.game.hasOwner(neighbor)) {
                hasNeutralLand = true;
                continue;
              }
              const owner = this.game.owner(neighbor);
              if (owner.isPlayer() && owner !== other) {
                targetIDs.add(owner.smallID());
              }
            }
          }
          for (const attack of other.outgoingAttacks()) {
            if (!attack.retreating) targetIDs.add(attack.targetID);
          }
          return [other.id(), { targetIDs, hasNeutralLand }] as const;
        }),
      ),
    );
    const ownActiveTargetIDs = new Set(
      player
        .outgoingAttacks()
        .filter((attack) => !attack.retreating)
        .map((attack) => attack.targetID),
    );
    const coalitionDecision = selectCoalitionTarget(
      this.game
        .players()
        .filter(
          (candidate) =>
            candidate.isAlive() &&
            candidate.type() === PlayerType.Nation &&
            !player.isFriendly(candidate),
        )
        .map((candidate) => {
          const forecast = this.opponentForecasts.get(candidate.id());
          const isStrategicTarget =
            candidate.id() === this.strategicPlan?.opponent?.id;
          const isIncoming = player
            .incomingAttacks()
            .some(
              (attack) =>
                !attack.retreating && attack.attackerID === candidate.smallID(),
            );
          return {
            targetId: candidate.id(),
            basePriority:
              (isIncoming ? 3 : 0) +
              (isStrategicTarget ? 2 : 0) +
              (forecast?.threat ?? 0) +
              candidate.outgoingAttacks().length * 0.25,
            ownCanReach:
              borderingPlayers.has(candidate.id()) ||
              ownActiveTargetIDs.has(candidate.smallID()) ||
              isStrategicTarget,
            enemyActiveWars:
              candidate.incomingAttacks().filter((attack) => !attack.retreating)
                .length +
              candidate.outgoingAttacks().filter((attack) => !attack.retreating)
                .length,
            helpers: allies.map(({ other, assessment }) => ({
              allyId: other.id(),
              reliability: assessment.reliability,
              reserveRatio:
                other.troops() /
                Math.max(1, this.game.config().maxTroops(other)),
              canReach:
                allyReachability
                  .get(other.id())
                  ?.targetIDs.has(candidate.smallID()) ?? false,
              treatyBlocked: other.isFriendly(candidate),
            })),
          };
        }),
    );
    const coalitionTarget =
      coalitionDecision === undefined
        ? undefined
        : this.game
            .players()
            .find((candidate) => candidate.id() === coalitionDecision.targetId);
    this.latestCoalitionTargetId = coalitionTarget?.id();
    this.latestCoalitionTargetCostMultiplier =
      coalitionDecision?.offensiveCostMultiplier ?? 1;
    this.latestCoalitionTarget = coalitionTarget?.name();
    this.latestCoalitionHelpers =
      coalitionDecision?.availableHelperIds.length ?? 0;
    this.latestCoalitionTreatyBlocks =
      coalitionDecision?.treatyBlockedHelperIds.length ?? 0;

    const plans = allies.flatMap(({ other, record, assessment }) => {
      const otherMaxTroops = Math.max(1, this.game.config().maxTroops(other));
      const allyIncomingTroops = other
        .incomingAttacks()
        .filter((attack) => !attack.retreating)
        .reduce((sum, attack) => sum + attack.troops, 0);
      const reachability = allyReachability.get(other.id());
      const sharedEnemy =
        coalitionTarget !== undefined &&
        (coalitionDecision?.availableHelperIds.includes(other.id()) ||
          reachability?.targetIDs.has(coalitionTarget.smallID()) === true)
          ? coalitionTarget
          : undefined;
      const sharedEnemyActiveWars =
        (sharedEnemy?.incomingAttacks().length ?? 0) +
        (sharedEnemy?.outgoingAttacks().length ?? 0);
      const allyCommittedTroops =
        sharedEnemy === undefined
          ? 0
          : other
              .outgoingAttacks()
              .filter(
                (attack) =>
                  !attack.retreating &&
                  attack.targetID === sharedEnemy.smallID(),
              )
              .reduce((sum, attack) => sum + attack.troops, 0);
      const allyCanPressureSharedEnemy =
        sharedEnemy !== undefined &&
        (reachability?.targetIDs.has(sharedEnemy.smallID()) ?? false);
      const communicationAction = planCommunication({
        aidRequest: {
          reserveRatio: player.troops() / ownMaxTroops,
          reserveFloor,
          incomingTroopRatio: incomingTroops / ownMaxTroops,
          gold: Number(player.gold()),
          plannedBuildCost: null,
          activeNationWars,
          hasTrustedAlly: assessment.trusted,
          ticksSinceLastRequest: tick - record.lastRequestTick,
        },
        donation: {
          reserveRatio: player.troops() / ownMaxTroops,
          reserveFloor,
          gold: Number(player.gold()),
          emergencyGoldFloor:
            this.economicPlan?.goldReserveFloor ??
            Number(player.gold()) * reserveFloor,
          activeNationWars,
          allyIncomingTroopRatio: assessment.trusted
            ? allyIncomingTroops / otherMaxTroops
            : 0,
          allyReserveRatio: other.troops() / otherMaxTroops,
        },
        coordination: {
          ownReserveRatio: player.troops() / ownMaxTroops,
          allyReserveRatio: other.troops() / otherMaxTroops,
          sharedEnemy:
            sharedEnemy !== undefined &&
            !other
              .outgoingAttacks()
              .some(
                (attack) =>
                  !attack.retreating &&
                  attack.targetID === sharedEnemy.smallID(),
              ),
          enemyActiveWars: sharedEnemyActiveWars,
          ownActiveNationWars: activeNationWars,
          ticksSinceLastMessage: tick - record.lastMessageTick,
        },
        ownTroops: player.troops(),
        ownMaxTroops,
        ownGold: Number(player.gold()),
        allyPlayerID: other.id(),
        sharedEnemyPlayerID: sharedEnemy?.id(),
        receivedMeaningfulAid:
          record.lastAidTick > record.lastThanksTick &&
          tick - record.lastAidTick <=
            allianceResponseWindowTicks({
              quickChatCooldownTicks: this.game.config().quickChatCooldown(),
              allianceDurationTicks: this.game.config().allianceDuration(),
            }),
        ticksSinceLastThanks: tick - record.lastThanksTick,
      });
      const allyHasGrowthRoute =
        reachability?.hasNeutralLand === true ||
        [...(reachability?.targetIDs ?? [])].some((smallID) => {
          const target = this.game.playerBySmallID(smallID);
          return (
            target.isPlayer() &&
            !other.isFriendly(target) &&
            !player.isFriendly(target)
          );
        });
      const growthSupport = planCoalitionGrowthSupport({
        ownTroops: player.troops(),
        ownMaxTroops,
        reserveFloor,
        activeNationWars,
        incomingFronts: player
          .incomingAttacks()
          .filter((attack) => !attack.retreating).length,
        allyTroops: other.troops(),
        allyMaxTroops: otherMaxTroops,
        allyReliability: assessment.reliability,
        allyIsNation: other.type() === PlayerType.Nation,
        canDonate:
          player.isFriendly(other) &&
          tick - record.lastDonationTick >= this.game.config().donateCooldown(),
        allyHasGrowthRoute,
        allyCommittedTroops,
        sharedEnemyTroops: sharedEnemy?.troops(),
        sharedEnemyMaxTroops:
          sharedEnemy === undefined
            ? undefined
            : this.game.config().maxTroops(sharedEnemy),
        sharedEnemyIsNation: sharedEnemy?.type() === PlayerType.Nation,
        allyCanPressureSharedEnemy,
        enemyGrowthAt:
          sharedEnemy === undefined
            ? undefined
            : (troops) =>
                this.game
                  .config()
                  .projectedTroopIncreaseRate(sharedEnemy, troops),
        troopGrowthAt: (troops) =>
          this.game.config().projectedTroopIncreaseRate(player, troops),
      });
      const growthSupportSelected =
        communicationAction.kind === "none" && growthSupport.donate;
      const action: CommunicationAction = growthSupportSelected
        ? { kind: "donate-troops", amount: growthSupport.amount }
        : communicationAction;
      const priority =
        action.kind === "quick-chat"
          ? action.key.startsWith("help.")
            ? 5
            : action.key === "attack.focus"
              ? 4
              : 1
          : action.kind === "donate-troops"
            ? 3
            : action.kind === "donate-gold"
              ? 2
              : 0;
      if (
        (action.kind === "donate-troops" || action.kind === "donate-gold") &&
        tick - record.lastDonationTick < this.game.config().donateCooldown()
      ) {
        return [];
      }
      if (
        action.kind === "quick-chat" &&
        (action.key === "attack.focus" || action.key === "help.help_defend") &&
        sharedEnemy === undefined
      ) {
        return [];
      }
      return action.kind === "none"
        ? []
        : [
            {
              other,
              record,
              assessment,
              sharedEnemy,
              growthSupport,
              growthSupportSelected,
              action,
              priority,
            },
          ];
    });
    const selected = plans.sort(
      (a, b) =>
        b.priority - a.priority ||
        b.assessment.reliability - a.assessment.reliability,
    )[0];
    if (selected === undefined) return false;

    const {
      other,
      record,
      sharedEnemy,
      growthSupport,
      growthSupportSelected,
      action,
    } = selected;
    if (action.kind === "quick-chat") {
      this.eventBus.emit(
        new SendQuickChatEvent(other, action.key, action.targetPlayerID),
      );
      record.lastMessageTick = tick;
      if (action.key === "greet.thanks") {
        record.lastThanksTick = tick;
      } else {
        record.requestsSent++;
        record.lastRequestTick = tick;
        record.pending = {
          kind: action.key === "attack.focus" ? "focus" : "aid",
          sentTick: tick,
          targetSmallID:
            action.key === "attack.focus" ? sharedEnemy?.smallID() : undefined,
        };
      }
      this.follow(other, 6);
      this.setDecision(
        action.key === "attack.focus"
          ? `Coordinate ${other.name()} against ${sharedEnemy?.name() ?? "the shared threat"}`
          : action.key === "greet.thanks"
            ? `Thank ${other.name()} for allied support`
            : `Request ${action.key.replace("help.", "").replace("_", " ")} from ${other.name()}`,
        action.key === "attack.focus"
          ? `Coalition planning found ${this.latestCoalitionHelpers} ally or allies that can legally reach ${sharedEnemy?.name() ?? "this target"}; ${this.latestCoalitionTreatyBlocks} reachable ally or allies are blocked by their own treaties. ${other.name()}'s reliability is ${Math.round(selected.assessment.reliability * 100)}%.`
          : `Alliance reliability is ${Math.round(selected.assessment.reliability * 100)}% at ${Math.round(selected.assessment.confidence * 100)}% confidence. The request will be scored from actual donations or shared-target attacks before renewal.`,
      );
      return true;
    }
    if (action.kind === "donate-troops") {
      record.lastDonationTick = tick;
      if (growthSupportSelected) {
        this.coalitionGrowthDonations++;
        this.latestCoalitionGrowthGain = growthSupport.growthRateGainRatio;
      }
      this.eventBus.emit(new SendDonateTroopsIntentEvent(other, action.amount));
      this.follow(other, 6);
      this.setDecision(
        growthSupportSelected
          ? growthSupport.purpose === "pressure"
            ? `Sustain ${other.name()}'s pressure on ${sharedEnemy?.name() ?? "the shared enemy"}`
            : `Invest surplus troops in ${other.name()}'s growth`
          : `Reinforce ally ${other.name()}`,
        growthSupportSelected
          ? growthSupport.purpose === "pressure"
            ? `${renderTroops(action.amount)} troops reinforce an existing allied attack while leaving our reserve at ${Math.round(growthSupport.ownReserveAfter * 100)}%. The shared enemy's projected regeneration falls from ${growthSupport.enemyGrowthRateBefore.toFixed(0)} to ${growthSupport.enemyGrowthRateAfter.toFixed(0)} troops per tick and its projected reserve falls to ${Math.round(growthSupport.projectedEnemyReserveAfter * 100)}%.`
            : `${renderTroops(action.amount)} troops give this reliable nation a legal expansion force while leaving our reserve at ${Math.round(growthSupport.ownReserveAfter * 100)}%. Projected home regeneration rises from ${growthSupport.growthRateBefore.toFixed(0)} to ${growthSupport.growthRateAfter.toFixed(0)} troops per tick instead of wasting an overfull bank.`
          : `${renderTroops(action.amount)} surplus troops are donated while preserving the live nation-front reserve floor. Reliability is ${Math.round(selected.assessment.reliability * 100)}%.`,
      );
      return true;
    }
    record.lastDonationTick = tick;
    this.eventBus.emit(
      new SendDonateGoldIntentEvent(other, BigInt(action.amount)),
    );
    this.follow(other, 6);
    this.setDecision(
      `Fund ally ${other.name()}`,
      `${action.amount.toLocaleString()} gold above the emergency economic reserve supports a trusted ally under pressure.`,
    );
    return true;
  }

  private tryManageAllianceLifecycle(
    player: PlayerView,
    borderingPlayers: ReadonlyMap<string, PlayerView>,
    activeNationWars: number,
  ): boolean {
    this.latestAllianceAction = "none";
    const tick = this.game.ticks();
    const maxTroops = Math.max(1, this.game.config().maxTroops(player));
    const activeIncoming = player
      .incomingAttacks()
      .filter((attack) => !attack.retreating);
    const hostileNationBorders = [...borderingPlayers.values()].filter(
      (candidate) =>
        candidate.type() === PlayerType.Nation && !player.isFriendly(candidate),
    ).length;
    const evaluations = player
      .alliances()
      .map((alliance) => {
        const other = this.game.player(alliance.other);
        if (!other.isAlive()) return undefined;
        const otherMaxTroops = Math.max(1, this.game.config().maxTroops(other));
        const otherTotalTroops =
          other.troops() +
          other
            .outgoingAttacks()
            .filter((attack) => !attack.retreating)
            .reduce((sum, attack) => sum + attack.troops, 0);
        const ownTotalTroops =
          player.troops() +
          player
            .outgoingAttacks()
            .filter((attack) => !attack.retreating)
            .reduce((sum, attack) => sum + attack.troops, 0);
        const cooperation = this.assessAllyCooperation(
          this.ensureAllyCooperationRecord(other, alliance.createdAt),
        );
        const replacementAvailable = this.game
          .players()
          .some(
            (candidate) =>
              candidate !== player &&
              candidate !== other &&
              candidate.isAlive() &&
              candidate.type() === PlayerType.Nation &&
              !player.isFriendly(candidate) &&
              !player.hasEmbargo(candidate) &&
              (this.allianceCooldownUntil.get(candidate.id()) ?? 0) <= tick &&
              candidate.troops() >= player.troops() * 0.35,
          );
        const plan = planAllianceLifecycle({
          isSameTeam: player.isOnSameTeam(other),
          otherIsTraitor: other.isTraitor(),
          sharesBorder: borderingPlayers.has(other.id()),
          ticksUntilExpiry: alliance.expiresAt - tick,
          betrayalPenaltyTicks: this.game.config().traitorDuration(),
          inExtensionWindow: alliance.hasExtensionRequest,
          ownReserveRatio: player.troops() / maxTroops,
          otherReserveRatio: other.troops() / otherMaxTroops,
          troopRatio: otherTotalTroops / Math.max(1, ownTotalTroops),
          capacityRatio: otherMaxTroops / maxTroops,
          territoryRatio:
            other.numTilesOwned() / Math.max(1, player.numTilesOwned()),
          allianceCount: player.alliances().length,
          hostileNationBorders,
          activeNationWars,
          incomingFronts: activeIncoming.length,
          cooperationReliability: cooperation.reliability,
          cooperationConfidence: cooperation.confidence,
          shouldReplaceUncooperativeAlly: cooperation.shouldReplace,
          replacementAvailable,
          otherPlayersAlive: this.game
            .players()
            .filter((candidate) => candidate !== player && candidate.isAlive())
            .length,
          forecast: this.opponentForecasts.get(other.id()),
        });
        return { alliance, other, plan, cooperation };
      })
      .filter(
        (evaluation): evaluation is NonNullable<typeof evaluation> =>
          evaluation !== undefined,
      )
      .sort((a, b) => {
        const priority: Record<AllianceLifecycleAction, number> = {
          break: 4,
          renew: 3,
          "do-not-renew": 2,
          keep: 1,
        };
        return priority[b.plan.action] - priority[a.plan.action];
      });

    for (const { alliance, other, plan, cooperation } of evaluations) {
      const extensionKey = `${alliance.id}:${alliance.expiresAt}`;
      if (plan.action !== "keep" || this.latestAllianceAction === "none") {
        this.latestAllianceAction = plan.action;
      }
      if (plan.action === "break") {
        this.eventBus.emit(new SendBreakAllianceIntentEvent(player, other));
        this.allianceCooldownUntil.set(
          other.id(),
          tick +
            this.game.config().traitorDuration() * 2 +
            this.game.config().allianceRequestCooldown(),
        );
        this.declinedAllianceExtensions.add(extensionKey);
        this.follow(other, 7);
        this.setDecision(
          `End the alliance with ${other.name()}`,
          `${plan.reason}. The live policy found no active nation war and enough home reserve to absorb the betrayal penalty before attempting the bordering elimination.`,
        );
        return true;
      }
      if (
        plan.action === "renew" &&
        alliance.hasExtensionRequest &&
        !this.handledAllianceExtensions.has(extensionKey) &&
        !this.declinedAllianceExtensions.has(extensionKey)
      ) {
        this.handledAllianceExtensions.add(extensionKey);
        this.eventBus.emit(new SendAllianceExtensionIntentEvent(other));
        this.follow(other, 6);
        this.setDecision(
          `Renew the alliance with ${other.name()}`,
          `${plan.reason}. Forecast: ${this.opponentForecasts.get(other.id())?.predictedChoice ?? "bank"} at ${Math.round((this.opponentForecasts.get(other.id())?.confidence ?? 0) * 100)}% confidence.`,
        );
        return true;
      }
      if (
        plan.action === "do-not-renew" &&
        !this.declinedAllianceExtensions.has(extensionKey)
      ) {
        this.declinedAllianceExtensions.add(extensionKey);
        this.allianceCooldownUntil.set(other.id(), alliance.expiresAt + 800);
        this.nextDiplomacyTick = Math.min(
          this.nextDiplomacyTick,
          alliance.expiresAt + 1,
        );
        this.follow(other, 6);
        this.setDecision(
          `Let the alliance with ${other.name()} expire`,
          `${plan.reason}. Cooperation is ${Math.round(cooperation.reliability * 100)}% reliable at ${Math.round(cooperation.confidence * 100)}% confidence. No extension is sent, avoiding the traitor penalty; diplomacy reopens as soon as the slot clears so a better partner can replace it.`,
        );
        continue;
      }
    }
    return false;
  }

  private tryFinishRemnant(
    player: PlayerView,
    enemies: ReadonlyMap<string, PlayerView>,
    frontIntel: ReadonlyMap<string, LandFrontIntel>,
    reserveFloor: number,
    activeNationWars: number,
    maximumNationWars: number,
  ): boolean {
    const ownMaxTroops = Math.max(1, this.game.config().maxTroops(player));
    const activeTargets = new Set(
      player
        .outgoingAttacks()
        .filter((attack) => !attack.retreating)
        .map((attack) => attack.targetID),
    );
    const plans = [...enemies.values()].map((target) => {
      const front = frontIntel.get(target.id());
      const predictedChoice = this.opponentForecasts.get(
        target.id(),
      )?.predictedChoice;
      const evaluate = (estimatedConquestTicks: number) =>
        planRemnantConquest({
          ownTroops: player.troops(),
          ownMaxTroops,
          ownTiles: player.numTilesOwned(),
          reserveFloor,
          targetTroops: target.troops(),
          targetFieldTroops: target
            .outgoingAttacks()
            .filter((attack) => !attack.retreating)
            .reduce((sum, attack) => sum + attack.troops, 0),
          targetMaxTroops: Math.max(1, this.game.config().maxTroops(target)),
          targetTiles: target.numTilesOwned(),
          targetGold: Number(target.gold()),
          capturesFullGold:
            target.type() === PlayerType.Bot ||
            target.type() === PlayerType.Nation,
          targetIsTribe: target.type() === PlayerType.Bot,
          targetIsAllied: player.isFriendly(target),
          sharesBorder: front !== undefined,
          activeNationWars,
          maximumNationWars,
          incomingFronts: player
            .incomingAttacks()
            .filter((attack) => !attack.retreating).length,
          alreadyFightingTarget: activeTargets.has(target.smallID()),
          terrainLossCost: front?.averageLossCost ?? 1,
          wrapPotential: front?.wrapPotential ?? 0,
          estimatedConquestTicks,
          predictedChoice,
        });
      const preliminaryTicks = this.estimatedLandAttackTicks(
        player,
        target,
        0.3,
        front,
        target.numTilesOwned(),
      );
      const preliminary = evaluate(preliminaryTicks);
      const estimatedConquestTicks = this.estimatedLandAttackTicks(
        player,
        target,
        preliminary.commitFraction,
        front,
        target.numTilesOwned(),
      );
      return {
        target,
        front,
        plan: evaluate(estimatedConquestTicks),
        alreadyActive: activeTargets.has(target.smallID()),
        predictedChoice,
      };
    });
    this.remnantTargetsSeen = plans.filter(({ plan }) => plan.isRemnant).length;
    const selected = plans
      .filter(({ plan, alreadyActive }) => plan.shouldAttack && !alreadyActive)
      .sort((a, b) => b.plan.score - a.plan.score)[0];
    if (selected === undefined) return false;

    this.attack(
      player,
      selected.target,
      selected.plan.commitFraction,
      selected.target.type() === PlayerType.Bot
        ? "Finish the tribe and collect its gold"
        : "Hunt down the remaining nation",
      `${selected.plan.reason}. ${Math.round(selected.plan.commitFraction * 100)}% is committed while the forecast leaves ${Math.round(selected.plan.projectedReserveRatio * 100)}% of capacity at home; the target is most likely to ${selected.predictedChoice ?? "bank"} next.`,
    );
    return true;
  }

  private async tryAlliance(
    player: PlayerView,
    enemies: Map<string, PlayerView>,
    enemyTiles: Map<string, number>,
    frontIntel: Map<string, LandFrontIntel>,
    reserveRatio: number,
    desiredAllianceCount: number,
  ): Promise<boolean> {
    if (
      this.game.ticks() < this.nextDiplomacyTick ||
      player.alliances().length >= desiredAllianceCount ||
      enemies.size === 0
    ) {
      return false;
    }
    this.nextDiplomacyTick = this.game.ticks() + 350;
    const candidates = [...enemies.values()]
      .filter(
        (candidate) =>
          candidate.type() === PlayerType.Nation &&
          !player.isRequestingAllianceWith(candidate) &&
          !player.hasEmbargo(candidate) &&
          (this.allianceCooldownUntil.get(candidate.id()) ?? 0) <=
            this.game.ticks(),
      )
      .sort((a, b) => {
        const aThreat =
          (a.troops() / Math.max(1, player.troops())) *
          Math.sqrt(frontIntel.get(a.id())?.borderWidth ?? 1);
        const bThreat =
          (b.troops() / Math.max(1, player.troops())) *
          Math.sqrt(frontIntel.get(b.id())?.borderWidth ?? 1);
        return bThreat - aThreat;
      });
    for (const candidate of candidates.slice(0, 4)) {
      const tile = enemyTiles.get(candidate.id());
      if (tile === undefined) continue;
      const actions = await player.actions(tile, null);
      if (actions.interaction?.canSendAllianceRequest !== true) continue;
      this.eventBus.emit(new SendAllianceRequestIntentEvent(player, candidate));
      this.follow(candidate, 6);
      this.setDecision(
        `Offer a temporary alliance to ${candidate.name()}`,
        `With ${Math.round(reserveRatio * 100)}% reserve and ${enemies.size} hostile borders, alliance ${player.alliances().length + 1}/${desiredAllianceCount} closes one of the widest or strongest fronts before the next commitment.`,
      );
      return true;
    }
    return false;
  }

  private handleIncomingAllianceRequests(player: PlayerView): void {
    for (const request of this.game.updatesSinceLastTick()?.[
      GameUpdateType.AllianceRequest
    ] ?? []) {
      if (request.recipientID !== player.smallID()) continue;
      const key = `${request.requestorID}:${request.createdAt}`;
      if (this.handledAllianceRequests.has(key)) continue;
      this.handledAllianceRequests.add(key);
      this.nextDiplomacyTick = Math.max(
        this.nextDiplomacyTick,
        this.game.ticks() + 80,
      );
      void this.respondToAllianceRequest(player, request).catch((error) => {
        console.error("Failed to answer alliance request", error);
      });
    }
  }

  private async respondToAllianceRequest(
    player: PlayerView,
    request: AllianceRequestUpdate,
  ): Promise<void> {
    const requestor = this.game.playerBySmallID(
      request.requestorID,
    ) as PlayerView;
    if (
      !requestor.isAlive() ||
      !requestor.isRequestingAllianceWith(player) ||
      requestor.isAlliedWith(player)
    ) {
      return;
    }

    for (const pendingID of this.pendingAllianceAcceptances) {
      const pending = this.game.playerBySmallID(pendingID) as PlayerView;
      if (
        !pending.isAlive() ||
        pending.isAlliedWith(player) ||
        !pending.isRequestingAllianceWith(player)
      ) {
        this.pendingAllianceAcceptances.delete(pendingID);
      }
    }

    const borders = await player.borderTiles();
    const front = this.analyzeLandFront(player, requestor, borders.borderTiles);
    const hostileBorderIDs = new Set<number>();
    for (const border of borders.borderTiles) {
      for (const neighbor of this.game.neighbors(border)) {
        if (!this.game.hasOwner(neighbor)) continue;
        const owner = this.game.owner(neighbor);
        if (
          owner.isPlayer() &&
          owner !== player &&
          owner.isAlive() &&
          !player.isFriendly(owner)
        ) {
          hostileBorderIDs.add(owner.smallID());
        }
      }
    }

    const troopRatio = requestor.troops() / Math.max(1, player.troops());
    const territoryRatio =
      requestor.numTilesOwned() / Math.max(1, player.numTilesOwned());
    const activeConflict = player
      .outgoingAttacks()
      .some((attack) => attack.targetID === requestor.smallID());
    const availableAllianceSlots =
      2 - player.alliances().length - this.pendingAllianceAcceptances.size;
    const closesDangerousFront =
      front !== undefined &&
      (front.borderWidth >= 3 || troopRatio >= 0.75 || territoryRatio >= 0.8);
    const usefulRemotePartner =
      front === undefined &&
      player.alliances().length === 0 &&
      (troopRatio >= 1 || territoryRatio >= 1);
    const crowdedBorders = hostileBorderIDs.size >= 3;
    const preservesBestExpansionRoute =
      front === undefined ||
      requestor.type() !== PlayerType.Bot ||
      front.wrapPotential < 0.45;
    const accept =
      shouldAcceptAlliance({
        availableAllianceSlots,
        activeConflict,
        requestorIsTribe: requestor.type() === PlayerType.Bot,
        preservesBestExpansionRoute,
        closesDangerousFront,
        usefulRemotePartner,
        crowdedBorders,
      }) &&
      (this.allianceCooldownUntil.get(requestor.id()) ?? 0) <=
        this.game.ticks();

    if (accept) {
      this.pendingAllianceAcceptances.add(requestor.smallID());
      this.eventBus.emit(new SendAllianceRequestIntentEvent(player, requestor));
      this.follow(requestor, 6);
      this.setDecision(
        `Accept ${requestor.name()}'s alliance request`,
        `The request closes ${front === undefined ? "a future" : `a width-${front.borderWidth}`} front. Their troop strength is ${Math.round(troopRatio * 100)}% of ours, territory is ${Math.round(territoryRatio * 100)}%, and ${hostileBorderIDs.size} hostile borders remain; reserving one of two alliance slots reduces third-party risk.`,
      );
      return;
    }

    this.eventBus.emit(new SendAllianceRejectIntentEvent(requestor));
    this.follow(requestor, 5);
    this.setDecision(
      `Decline ${requestor.name()}'s alliance request`,
      activeConflict
        ? "An attack is already active between us, so the request cannot safely close this front."
        : availableAllianceSlots <= 0
          ? "Both strategic alliance slots are already committed or awaiting confirmation."
          : requestor.type() === PlayerType.Bot || !preservesBestExpansionRoute
            ? "This weak or surroundable neighbor is currently the best low-risk expansion route, so an alliance would block growth."
            : `The request does not close a dangerous border: requester strength ${Math.round(troopRatio * 100)}%, territory ${Math.round(territoryRatio * 100)}%, hostile borders ${hostileBorderIDs.size}.`,
    );
  }

  private tryStartDenialAttack(
    player: PlayerView,
    enemies: Map<string, PlayerView>,
    enemyTiles: Map<string, number>,
    frontIntel: Map<string, LandFrontIntel>,
    reserveRatio: number,
    activeNationWarIDs: ReadonlySet<string>,
    activeNationOffensiveIDs: ReadonlySet<string>,
    maxNationOffensives: number,
  ): boolean {
    if (
      this.game.ticks() < this.nextRaidTick ||
      reserveRatio <
        Math.max(
          0.36,
          Math.min(
            0.58,
            0.38 +
              (1 - this.raidSuccessRate()) * 0.06 +
              this.retaliationRate() * 0.12 +
              this.eliminationRate() * 0.08 -
              this.activeGene("Aggression") * 0.06 +
              this.activeGene("Caution") * 0.08,
          ),
        ) ||
      player.outgoingAttacks().length > 0 ||
      player.incomingAttacks().length > 0
    ) {
      return false;
    }

    const ourDensity = player.troops() / Math.max(1, player.numTilesOwned());
    const candidates = [...enemies.values()]
      .filter((candidate) => {
        if (
          candidate.type() === PlayerType.Nation &&
          !activeNationWarIDs.has(candidate.id()) &&
          !activeNationOffensiveIDs.has(candidate.id()) &&
          (activeNationWarIDs.size > 0 ||
            activeNationOffensiveIDs.size >= maxNationOffensives)
        ) {
          return false;
        }
        if (player.isRequestingAllianceWith(candidate)) return false;
        const targetDensity =
          candidate.troops() / Math.max(1, candidate.numTilesOwned());
        const isDistracted = candidate.outgoingAttacks().length > 0;
        const learnedDensityLimit =
          0.95 +
          this.raidSuccessRate() * 0.35 -
          this.retaliationRate() * 0.2 +
          this.activeGene("Aggression") * 0.2 -
          this.activeGene("Caution") * 0.1;
        const affordableBorder =
          targetDensity < ourDensity * learnedDensityLimit;
        const isTribe = candidate.type() === PlayerType.Bot;
        if (
          !shouldRiskDenialRaid({
            isTribe,
            nationBorders: this.verifiedNationBorders.size,
            targetTroops: candidate.troops(),
            ourTroops: player.troops(),
            targetDistracted: isDistracted,
            reserveRatio,
          })
        ) {
          return false;
        }
        const contactTile = enemyTiles.get(candidate.id());
        const front = frontIntel.get(candidate.id());
        const hasBorderCity =
          contactTile !== undefined &&
          this.borderCityNear(candidate, contactTile) !== undefined;
        const terrainIsAffordable =
          front === undefined ||
          front.averageLossCost <= 1.8 ||
          player.troops() >= candidate.troops() * 2.5;
        return (
          terrainIsAffordable &&
          player.troops() >=
            candidate.troops() *
              (hasBorderCity
                ? 0.35
                : Math.max(
                    0.32,
                    0.48 -
                      this.raidSuccessRate() * 0.14 +
                      this.retaliationRate() * 0.1,
                  )) &&
          (isDistracted || affordableBorder || isTribe || hasBorderCity)
        );
      })
      .sort((a, b) => {
        const aContact = enemyTiles.get(a.id());
        const bContact = enemyTiles.get(b.id());
        const aHasCity =
          aContact !== undefined &&
          this.borderCityNear(a, aContact) !== undefined;
        const bHasCity =
          bContact !== undefined &&
          this.borderCityNear(b, bContact) !== undefined;
        if (aHasCity !== bHasCity) return aHasCity ? -1 : 1;
        const aFront = frontIntel.get(a.id());
        const bFront = frontIntel.get(b.id());
        const score = (candidate: PlayerView, front?: LandFrontIntel) =>
          (this.normalizedPlayerDistance(player, candidate) +
            (front?.averageLossCost ?? 1) * 0.25 -
            (front?.wrapPotential ?? 0) * 0.2) *
          (candidate.id() === this.latestCoalitionTargetId
            ? this.latestCoalitionTargetCostMultiplier
            : 1);
        return score(a, aFront) - score(b, bFront);
      });
    const target = candidates[0];
    if (target === undefined) return false;

    const contactTile = enemyTiles.get(target.id());
    const borderCity =
      contactTile === undefined
        ? undefined
        : this.borderCityNear(target, contactTile);
    const targetFront = frontIntel.get(target.id());
    const learnedNationFraction = Math.max(
      0.08,
      Math.min(
        0.18,
        0.1 +
          this.raidSuccessRate() * 0.06 -
          this.retaliationRate() * 0.03 +
          this.activeGene("Aggression") * 0.03 -
          this.activeGene("Caution") * 0.02,
      ),
    );
    const desiredFraction =
      borderCity !== undefined
        ? Math.min(0.2, learnedNationFraction + 0.05)
        : target.type() === PlayerType.Bot
          ? Math.min(0.2, learnedNationFraction + 0.03)
          : learnedNationFraction;
    const fraction = Math.min(
      desiredFraction,
      Math.max(0.06, (reserveRatio - 0.4) / Math.max(0.01, reserveRatio)),
    );
    const troopsAfterLaunch = player.troops() * (1 - fraction);
    const plausibleRetaliation = target.troops() * 0.35;
    const learnedRetaliationReserve = Math.max(
      1.05,
      1 +
        this.retaliationRate() * 0.2 +
        this.eliminationRate() * 0.1 +
        this.activeGene("Caution") * 0.12 -
        this.activeGene("Aggression") * 0.04,
    );
    if (troopsAfterLaunch < plausibleRetaliation * learnedRetaliationReserve) {
      return false;
    }

    const targetGain = Math.max(10, Math.ceil(player.numTilesOwned() * 0.006));
    const learnedDeadline = Math.round(
      Math.max(
        30,
        Math.min(
          72,
          42 +
            this.raidSuccessRate() * 16 +
            this.activeGene("Aggression") * 6 -
            this.activeGene("Caution") * 5,
        ),
      ),
    );
    const minimumHoldTicks = Math.max(24, Math.round(learnedDeadline * 0.7));
    const maximumGambleTicks = learnedDeadline * 3;
    const estimatedLandGrabTicks = this.estimatedLandAttackTicks(
      player,
      target,
      fraction,
      targetFront,
      targetGain,
    );
    if (estimatedLandGrabTicks > maximumGambleTicks) return false;
    this.activeRaid = {
      targetSmallID: target.smallID(),
      targetName: target.name(),
      startTick: this.game.ticks(),
      startTiles: player.numTilesOwned(),
      targetGain,
      committedTroops: player.troops() * fraction,
      targetTroopsAtStart: target.troops(),
      targetTilesAtStart: target.numTilesOwned(),
      minimumHoldTicks,
      deadlineTicks: learnedDeadline,
      maximumGambleTicks,
      purpose: "denial",
    };
    this.learning.raidAttempts++;
    this.saveLearning();
    this.attack(
      player,
      target,
      fraction,
      borderCity === undefined
        ? "Deny the nearest border"
        : "Snatch a border city",
      `${Math.round(fraction * 100)}% attacks ${borderCity === undefined ? "the nearest distracted or affordable neighbor" : "a city close to the shared border"} through a ${targetFront?.terrainLabel ?? "mixed"} front of width ${targetFront?.borderWidth ?? 1}. The game-speed estimate is ${estimatedLandGrabTicks} ticks for the ${targetGain}-tile land grab, within the ${maximumGambleTicks}-tick wager window; full conquest is not required.`,
    );
    if (borderCity !== undefined && this.overlay.followCamera) {
      this.eventBus.emit(new GoToUnitEvent(borderCity));
    }
    return true;
  }

  private tryConquerTribe(
    player: PlayerView,
    enemies: Map<string, PlayerView>,
    frontIntel: Map<string, LandFrontIntel>,
    reserveRatio: number,
    frontReserveFloor: number,
  ): boolean {
    const outgoing = player.outgoingAttacks();
    const opening = player.numTilesOwned() < 2_000;
    const maximumTribeFronts = opening ? 5 : 1;
    const minimumReserve = Math.max(
      0.48 + outgoing.length * 0.04,
      frontReserveFloor + 0.08,
    );
    const reserveLimitedCommitment = Math.max(
      0,
      (reserveRatio - 0.38) / Math.max(0.01, reserveRatio),
    );
    const maximumCommitment = Math.min(
      outgoing.length === 0 ? 0.68 : 0.28,
      reserveLimitedCommitment,
    );
    const activeTargets = new Set(outgoing.map((attack) => attack.targetID));
    if (
      reserveRatio < minimumReserve ||
      outgoing.length >= maximumTribeFronts ||
      player.incomingAttacks().length > 0
    ) {
      return false;
    }
    const target = [...enemies.values()]
      .filter((candidate) => candidate.type() === PlayerType.Bot)
      .filter((candidate) => !activeTargets.has(candidate.smallID()))
      .filter((candidate) => {
        const front = frontIntel.get(candidate.id());
        const distracted = candidate.outgoingAttacks().length > 0;
        const requiredAdvantage =
          candidate.numTilesOwned() <= 200 ? 1.02 : distracted ? 0.82 : 0.95;
        const effectiveCost =
          candidate.troops() *
          (front?.averageLossCost ?? 1) *
          (1 - (front?.wrapPotential ?? 0) * 0.28);
        const candidateCommitment =
          player.troops() >= candidate.troops() * 2 ? 1 : maximumCommitment;
        const estimatedConquestTicks = this.estimatedLandAttackTicks(
          player,
          candidate,
          candidateCommitment,
          front,
          candidate.numTilesOwned(),
        );
        return (
          player.troops() >= candidate.troops() * requiredAdvantage &&
          effectiveCost * 1.08 <= player.troops() * candidateCommitment &&
          (estimatedConquestTicks <= (opening ? 360 : 600) ||
            (front?.wrapPotential ?? 0) >= 0.5)
        );
      })
      .sort((a, b) => {
        const aFront = frontIntel.get(a.id());
        const bFront = frontIntel.get(b.id());
        const aFinishCost =
          a.troops() *
          (1 + this.normalizedPlayerDistance(player, a)) *
          Math.max(0.4, a.numTilesOwned() / 500) *
          (aFront?.averageLossCost ?? 1) *
          (1 - (aFront?.wrapPotential ?? 0) * 0.35);
        const bFinishCost =
          b.troops() *
          (1 + this.normalizedPlayerDistance(player, b)) *
          Math.max(0.4, b.numTilesOwned() / 500) *
          (bFront?.averageLossCost ?? 1) *
          (1 - (bFront?.wrapPotential ?? 0) * 0.35);
        const aTicks = this.estimatedLandAttackTicks(
          player,
          a,
          Math.max(0.12, maximumCommitment),
          aFront,
          a.numTilesOwned(),
        );
        const bTicks = this.estimatedLandAttackTicks(
          player,
          b,
          Math.max(0.12, maximumCommitment),
          bFront,
          b.numTilesOwned(),
        );
        // The opening objective is growth speed: value territory gained per
        // conquest tick, with a small bonus for surroundable land and a cost
        // penalty so a huge but painfully slow tribe does not bottleneck the
        // expansion cycle.
        const aGrowthRate = a.numTilesOwned() / Math.max(1, aTicks);
        const bGrowthRate = b.numTilesOwned() / Math.max(1, bTicks);
        const aGrowthScore =
          aGrowthRate * (1 + (aFront?.wrapPotential ?? 0) * 0.25) -
          aFinishCost * 0.0005;
        const bGrowthScore =
          bGrowthRate * (1 + (bFront?.wrapPotential ?? 0) * 0.25) -
          bFinishCost * 0.0005;
        return bGrowthScore - aGrowthScore;
      })[0];
    if (target === undefined) return false;

    const overwhelmingTribeAdvantage = player.troops() >= target.troops() * 2;
    const targetFront = frontIntel.get(target.id());
    const protectedReserveCommitment = Math.max(
      0,
      (reserveRatio - 0.35) / Math.max(0.01, reserveRatio),
    );
    const fraction = overwhelmingTribeAdvantage
      ? Math.min(1, protectedReserveCommitment)
      : Math.max(
          outgoing.length === 0 ? 0.18 : 0.12,
          Math.min(
            1,
            protectedReserveCommitment,
            (target.troops() *
              (tribeAttackCommitmentMultiplier(
                player.troops(),
                target.troops(),
              ) +
                (targetFront?.wrapPotential ?? 0) * 0.45)) /
              Math.max(1, player.troops()),
          ),
        );
    const estimatedConquestTicks = this.estimatedLandAttackTicks(
      player,
      target,
      fraction,
      targetFront,
      target.numTilesOwned(),
    );
    if (
      !overwhelmingTribeAdvantage &&
      estimatedConquestTicks > (opening ? 360 : 600) &&
      (targetFront?.wrapPotential ?? 0) < 0.5
    ) {
      return false;
    }
    const maxPushRisk = overwhelmingTribeAdvantage
      ? {
          allowed: fraction >= 0.12,
          reason: "the tribe is decisively outnumbered",
        }
      : assessMaxPushRisk({
          reserveRatio,
          commitFractionOfCurrent: fraction,
          activeFronts: outgoing.length,
          defenderTroopRatio:
            target.troops() / Math.max(1, player.troops() * fraction),
          takeSpeedMultiplier:
            outgoing.length === 0 && fraction >= 0.55 ? 2 : 1,
        });
    if (!maxPushRisk.allowed) {
      this.follow(target, 6);
      this.setDecision(
        `Avoid a risky tribe max push on ${target.name()}`,
        `${maxPushRisk.reason}. The trainer will use a smaller tribe capture or regenerate instead of exposing its land for a faster but wipe-prone push.`,
      );
      return false;
    }
    this.attack(
      player,
      target,
      fraction,
      "Conquer a tribe for gold and land",
      `${Math.round(fraction * 100)}% is committed to ${target.name()} on tribe front ${outgoing.length + 1}/${maximumTribeFronts}. ${overwhelmingTribeAdvantage ? "The tribe is at least 2× outnumbered, so the AI commits the entire force for a decisive capture instead of leaving a slow, exposed squad behind." : fraction >= 0.55 ? "The capture commits the full force needed to finish the tribe quickly." : "The trainer is committing the calculated finishing force rather than slowly wittling the tribe down."} The game formula estimates ${estimatedConquestTicks} ticks through its width-${targetFront?.borderWidth ?? 1} ${targetFront?.terrainLabel ?? "mixed"} front; ${Math.round((targetFront?.wrapPotential ?? 0) * 100)}% surround potential can shorten that through annexation.`,
    );
    return true;
  }

  private borderCityNear(player: PlayerView, contactTile: number) {
    return player
      .units(UnitType.City)
      .filter(
        (city) =>
          this.game.euclideanDistSquared(city.tile(), contactTile) <= 45 ** 2,
      )
      .sort(
        (a, b) =>
          this.game.euclideanDistSquared(a.tile(), contactTile) -
          this.game.euclideanDistSquared(b.tile(), contactTile),
      )[0];
  }

  private async hasWeakNationEscapeRoute(
    player: PlayerView,
    currentEnemy: PlayerView,
  ): Promise<boolean> {
    const enemyBorders = await currentEnemy.borderTiles();
    const enemyBorderNeighbors = new Set(
      [...enemyBorders.borderTiles]
        .flatMap((tile) => this.game.neighbors(tile))
        .filter((tile) => this.game.hasOwner(tile))
        .map((tile) => this.game.owner(tile).id()),
    );
    return this.game
      .players()
      .some(
        (candidate) =>
          candidate !== player &&
          candidate !== currentEnemy &&
          candidate.isAlive() &&
          candidate.type() === PlayerType.Nation &&
          !enemyBorderNeighbors.has(candidate.id()) &&
          candidate.troops() < currentEnemy.troops(),
      );
  }

  private interiorBuildCandidates(
    player: PlayerView,
    borders: ReadonlySet<number>,
    maximumDepth: number,
  ): Array<{ tile: number; depth: number }> {
    const depths = new Map<number, number>();
    const queue: number[] = [];
    for (const border of borders) {
      depths.set(border, 0);
      queue.push(border);
    }
    for (let index = 0; index < queue.length; index++) {
      const tile = queue[index];
      const depth = depths.get(tile) ?? 0;
      if (depth >= maximumDepth) continue;
      for (const neighbor of this.game.neighbors(tile)) {
        if (
          depths.has(neighbor) ||
          !this.game.hasOwner(neighbor) ||
          this.game.owner(neighbor) !== player
        ) {
          continue;
        }
        depths.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
    }
    return [...depths.entries()]
      .map(([tile, depth]) => ({ tile, depth }))
      .sort(
        (a, b) =>
          b.depth - a.depth ||
          Number(this.game.isShore(a.tile)) - Number(this.game.isShore(b.tile)),
      );
  }

  private analyzeLandFront(
    player: PlayerView,
    target: PlayerView,
    playerBorders: ReadonlySet<number>,
  ): LandFrontIntel | undefined {
    const contacts = new Map<
      number,
      {
        speedCost: number;
        lossCost: number;
        defended: boolean;
        friendlySides: number;
        label: string;
      }
    >();
    let borderWidth = 0;
    for (const border of playerBorders) {
      for (const neighbor of this.game.neighbors(border)) {
        if (
          !this.game.hasOwner(neighbor) ||
          this.game.owner(neighbor) !== target
        ) {
          continue;
        }
        borderWidth++;
        if (contacts.has(neighbor)) continue;
        const terrain = this.landingTerrain(neighbor, target);
        contacts.set(neighbor, {
          speedCost: Math.min(
            12,
            terrain.multiplier *
              (terrain.hasDefensePost
                ? this.game.config().defensePostSpeedBonus()
                : 1),
          ),
          lossCost: Math.min(
            12,
            terrain.lossMultiplier *
              (terrain.hasDefensePost
                ? this.game.config().defensePostDefenseBonus()
                : 1),
          ),
          defended: terrain.hasDefensePost,
          friendlySides: this.game
            .neighbors(neighbor)
            .filter(
              (adjacent) =>
                this.game.hasOwner(adjacent) &&
                this.game.owner(adjacent) === player,
            ).length,
          label: terrain.label,
        });
      }
    }
    if (contacts.size === 0) return undefined;
    const entries = [...contacts.entries()];
    const best = entries.sort(
      ([, a], [, b]) =>
        a.lossCost -
        a.friendlySides * 0.18 -
        (b.lossCost - b.friendlySides * 0.18),
    )[0];
    const averageSpeedCost =
      entries.reduce((sum, [, contact]) => sum + contact.speedCost, 0) /
      entries.length;
    const averageLossCost =
      entries.reduce((sum, [, contact]) => sum + contact.lossCost, 0) /
      entries.length;
    const defendedContactRatio =
      entries.filter(([, contact]) => contact.defended).length / entries.length;
    const wrapPotential =
      entries.reduce(
        (sum, [, contact]) => sum + Math.min(1, contact.friendlySides / 3),
        0,
      ) / entries.length;
    const terrainCounts = new Map<string, number>();
    for (const [, contact] of entries) {
      terrainCounts.set(
        contact.label,
        (terrainCounts.get(contact.label) ?? 0) + 1,
      );
    }
    const terrainLabel = [...terrainCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];
    return {
      contactTile: best[0],
      borderWidth: Math.max(1, borderWidth),
      averageSpeedCost,
      averageLossCost,
      defendedContactRatio,
      wrapPotential,
      terrainLabel,
    };
  }

  private estimatedLandAttackTicks(
    player: PlayerView,
    target: PlayerView,
    fraction: number,
    front: LandFrontIntel | undefined,
    tilesToTake: number,
  ): number {
    return estimateLandAttackTicks({
      attackerTroops: player.troops(),
      defenderTroops: target.troops(),
      fraction,
      borderWidth: front?.borderWidth ?? 1,
      combatCost: front?.averageSpeedCost ?? 1,
      tilesToTake,
    });
  }

  private tryStartLandRaid(
    player: PlayerView,
    enemies: Map<string, PlayerView>,
    frontIntel: Map<string, LandFrontIntel>,
    reserveRatio: number,
    activeNationWarIDs: ReadonlySet<string>,
    activeNationOffensiveIDs: ReadonlySet<string>,
    maxNationOffensives: number,
  ): boolean {
    if (
      this.game.ticks() < this.nextRaidTick ||
      reserveRatio < 0.7 ||
      player.outgoingAttacks().length > 0 ||
      player.incomingAttacks().length > 0
    ) {
      return false;
    }
    const target = [...enemies.values()]
      .filter(
        (candidate) =>
          (candidate.type() !== PlayerType.Nation ||
            activeNationWarIDs.has(candidate.id()) ||
            activeNationOffensiveIDs.has(candidate.id()) ||
            (activeNationWarIDs.size === 0 &&
              activeNationOffensiveIDs.size < maxNationOffensives)) &&
          player.hasEmbargo(candidate) &&
          player.troops() >= candidate.troops() * 0.85,
      )
      .sort(
        (a, b) =>
          (a.troops() / Math.max(1, a.numTilesOwned())) *
            (1 + this.normalizedPlayerDistance(player, a)) *
            (frontIntel.get(a.id())?.averageLossCost ?? 1) *
            (a.id() === this.latestCoalitionTargetId
              ? this.latestCoalitionTargetCostMultiplier
              : 1) -
          (b.troops() / Math.max(1, b.numTilesOwned())) *
            (1 + this.normalizedPlayerDistance(player, b)) *
            (frontIntel.get(b.id())?.averageLossCost ?? 1) *
            (b.id() === this.latestCoalitionTargetId
              ? this.latestCoalitionTargetCostMultiplier
              : 1),
      )[0];
    if (target === undefined) return false;

    const fraction = 0.06;
    const troopsAfterLaunch = player.troops() * (1 - fraction);
    const plausibleRetaliation = target.troops() * 0.35;
    if (troopsAfterLaunch < plausibleRetaliation * 1.35) return false;

    const minimumHoldTicks = 32;
    const deadlineTicks = 48;
    const maximumGambleTicks = deadlineTicks * 3;
    const targetGain = Math.max(6, Math.ceil(player.numTilesOwned() * 0.004));
    const targetFront = frontIntel.get(target.id());
    const estimatedLandGrabTicks = this.estimatedLandAttackTicks(
      player,
      target,
      fraction,
      targetFront,
      targetGain,
    );
    if (estimatedLandGrabTicks > maximumGambleTicks) return false;
    const committedTroops = player.troops() * fraction;
    const projectedEnemyTroops = this.projectRegeneration(
      target.troops(),
      Math.max(1, this.game.config().maxTroops(target)),
      estimatedLandGrabTicks,
    );
    const landGrab = assessGrowthAwareLandGrab({
      committedTroops,
      currentEnemyTroops: target.troops(),
      projectedEnemyTroops,
      targetTiles: target.numTilesOwned(),
      expectedCapturedTiles: targetGain,
      estimatedTicks: estimatedLandGrabTicks,
      terrainLossMultiplier: targetFront?.averageLossCost ?? 1,
      retreatLossRatio: ATTACK_RETREAT_MALUS_PERCENT / 100,
    });
    if (!landGrab.worthwhile) {
      this.follow(target, 6);
      this.setDecision(
        `Reject a low-value land grab on ${target.name()}`,
        `${landGrab.reason}. The defender projects to ${renderTroops(projectedEnemyTroops)} after ${estimatedLandGrabTicks} ticks, or ${landGrab.projectedForceRatio.toFixed(2)}× the raid force. Expected land and growth denial value ${renderTroops(landGrab.expectedValue)} does not safely beat ${renderTroops(landGrab.expectedCost)} projected attrition.`,
      );
      return false;
    }
    this.activeRaid = {
      targetSmallID: target.smallID(),
      targetName: target.name(),
      startTick: this.game.ticks(),
      startTiles: player.numTilesOwned(),
      targetGain,
      committedTroops,
      targetTroopsAtStart: target.troops(),
      targetTilesAtStart: target.numTilesOwned(),
      minimumHoldTicks,
      deadlineTicks,
      maximumGambleTicks,
      purpose: "hostile raid",
    };
    this.learning.raidAttempts++;
    this.saveLearning();
    this.attack(
      player,
      target,
      fraction,
      "Probe a hostile border",
      `This 6% land grab is estimated at ${estimatedLandGrabTicks} ticks for ${targetGain} tiles through a ${targetFront?.terrainLabel ?? "mixed"} front. The defender is projected to grow by ${renderTroops(landGrab.projectedEnemyGrowth)} before completion; captured land plus denied growth is valued at ${renderTroops(landGrab.expectedValue)} against ${renderTroops(landGrab.expectedCost)} expected attrition.`,
    );
    return true;
  }

  private monitorLandRaid(player: PlayerView | null): void {
    if (player === null || this.activeRaid === undefined) return;
    const raid = this.activeRaid;
    const attack = player
      .outgoingAttacks()
      .find((candidate) => candidate.targetID === raid.targetSmallID);
    if (attack !== undefined && raid.attackID === undefined) {
      raid.attackID = attack.id;
    }
    if (raid.attackID === undefined) {
      if (this.game.ticks() - raid.startTick > 5) this.activeRaid = undefined;
      return;
    }
    const activeAttack = player
      .outgoingAttacks()
      .find((candidate) => candidate.id === raid.attackID);
    if (activeAttack === undefined) {
      this.recordRaidOutcome(raid, player.numTilesOwned() - raid.startTiles);
      this.activeRaid = undefined;
      this.nextRaidTick = this.game.ticks() + this.learnedRaidCooldown(raid);
      return;
    }
    const gained = player.numTilesOwned() - raid.startTiles;
    const age = this.game.ticks() - raid.startTick;
    const activeIncoming = player
      .incomingAttacks()
      .filter((incoming) => !incoming.retreating);
    const totalIncomingTroops = activeIncoming.reduce(
      (sum, incoming) => sum + incoming.troops,
      0,
    );
    const thirdPartyIncomingTroops = activeIncoming
      .filter((incoming) => incoming.attackerID !== raid.targetSmallID)
      .reduce((sum, incoming) => sum + incoming.troops, 0);
    const observedLoss = this.observedDefenseLossRates();
    const activeNationWarIDs = new Set(
      [
        ...activeIncoming.map((attack) => attack.attackerID),
        ...player.outgoingAttacks().map((attack) => attack.targetID),
      ]
        .map((smallID) => this.game.playerBySmallID(smallID))
        .filter((candidate) => candidate.isPlayer())
        .filter((candidate) => candidate.type() === PlayerType.Nation)
        .map((candidate) => candidate.id()),
    );
    const reserveFloorRatio = nationFrontPolicy({
      nationFronts: Math.max(
        this.verifiedNationBorders.size,
        activeNationWarIDs.size,
      ),
      activeNationWars: activeNationWarIDs.size,
    }).reserveFloor;
    const recallProjection = evaluateRaidRecallDefense({
      homeTroops: player.troops(),
      maxTroops: this.game.config().maxTroops(player),
      raidTroops: activeAttack.troops,
      totalIncomingTroops,
      thirdPartyIncomingTroops,
      ownedTiles: player.numTilesOwned(),
      observedTileLossPerTick: observedLoss.tileLossPerTick,
      observedTroopLossPerTick: observedLoss.troopLossPerTick,
      returnDelayTicks: ATTACK_RETREAT_DELAY_TICKS,
      raidReturnSurvivalRatio: 1 - ATTACK_RETREAT_MALUS_PERCENT / 100,
      reserveFloorRatio,
    });
    // Minimum hold time prevents wasteful voluntary retreats, but never traps
    // a raid outside the nation while another front is projected to consume
    // the home reserve before survivors can return.
    if (age < raid.minimumHoldTicks && !recallProjection.recall) return;

    const target = this.game
      .players()
      .find((candidate) => candidate.smallID() === raid.targetSmallID);
    const targetDensity =
      raid.targetTroopsAtStart / Math.max(1, raid.targetTilesAtStart);
    const capturedLandValue = Math.max(0, gained) * targetDensity;
    const defenderLoss =
      target === undefined
        ? raid.targetTroopsAtStart
        : Math.max(0, raid.targetTroopsAtStart - target.troops());
    const realizedValue = capturedLandValue + defenderLoss;
    const recallLoss = activeAttack.troops * 0.25;
    const raidPaidForItself =
      gained >= raid.targetGain && realizedValue >= recallLoss;
    const targetIsCounterattacking = activeIncoming.some(
      (incoming) => incoming.attackerID === raid.targetSmallID,
    );
    const forceIsDepleted = activeAttack.troops <= raid.committedTroops * 0.35;
    const counterattackTroops = activeIncoming
      .filter((incoming) => incoming.attackerID === raid.targetSmallID)
      .reduce((sum, incoming) => sum + incoming.troops, 0);
    const projectedReturnAge = age + ATTACK_RETREAT_DELAY_TICKS;
    const justifiedRecall =
      raidPaidForItself &&
      (projectedReturnAge >= raid.deadlineTicks || targetIsCounterattacking);
    const emergencyRecall =
      recallProjection.recall ||
      (projectedReturnAge >= raid.maximumGambleTicks && forceIsDepleted);
    if (!justifiedRecall && !emergencyRecall) {
      if (age >= raid.deadlineTicks && !raid.gambleAnnounced) {
        raid.gambleAnnounced = true;
        this.setDecision(
          `Keep the ${raid.purpose} committed as a gamble`,
          `${Math.max(0, gained).toLocaleString()} tiles and about ${renderTroops(defenderLoss)} defender losses do not yet cover the roughly ${renderTroops(recallLoss)} a recall would destroy. The attack stays on ${raid.targetName}; it will only cut the loss after a counterattack or severe depletion.`,
        );
      }
      return;
    }

    this.eventBus.emit(new CancelAttackIntentEvent(raid.attackID));
    this.recordRaidOutcome(raid, gained);
    this.activeRaid = undefined;
    this.nextRaidTick = this.game.ticks() + this.learnedRaidCooldown(raid);
    this.nextDecisionTick = this.game.ticks() + 1;
    this.setDecision(
      `Recall the ${raid.purpose} from ${raid.targetName}`,
      recallProjection.recall
        ? `${recallProjection.thirdPartyPressure ? "A third-party attack" : "The target counterattack"} projects only ${renderTroops(recallProjection.projectedHomeTroops)} home troops from the visible force and the current ${Math.round(recallProjection.projectedCaptureRatio * 100)}% measured capture trend, below the ${Math.round(recallProjection.reserveFloorRatio * 100)}% capacity floor. About ${renderTroops(recallProjection.returningTroops)} survivors are ordered home under the engine's retreat rule instead of waiting for the wager to pay.`
        : emergencyRecall
          ? `After ${age} ticks the ${ATTACK_RETREAT_DELAY_TICKS}-tick return delay projects ${renderTroops(counterattackTroops)} pressuring the reserve before survivors return, or the raid reaching its limit below 35% strength. The AI accepts a roughly ${renderTroops(recallLoss)} retreat loss to prevent a larger collapse.`
          : `${Math.max(0, gained).toLocaleString()} tiles plus about ${renderTroops(defenderLoss)} defender losses justified the roughly ${renderTroops(recallLoss)} recall cost after ${age} ticks. The remaining force now preserves the retaliation reserve.`,
    );
  }

  private recordRaidOutcome(
    raid: NonNullable<VisualAiTrainer["activeRaid"]>,
    gained: number,
  ): void {
    if (gained >= raid.targetGain) this.learning.raidSuccesses++;
    this.retaliationWatch = {
      targetSmallID: raid.targetSmallID,
      untilTick: this.game.ticks() + 120,
    };
    this.saveLearning();
  }

  private monitorRetaliation(player: PlayerView | null): void {
    if (player === null || this.retaliationWatch === undefined) return;
    if (this.game.ticks() > this.retaliationWatch.untilTick) {
      this.retaliationWatch = undefined;
      return;
    }
    if (
      player
        .incomingAttacks()
        .some(
          (attack) =>
            !attack.retreating &&
            attack.attackerID === this.retaliationWatch?.targetSmallID,
        )
    ) {
      this.learning.raidRetaliations++;
      this.retaliationWatch = undefined;
      this.saveLearning();
    }
  }

  private normalizedPlayerDistance(a: PlayerView, b: PlayerView): number {
    const aLocation = a.nameLocation();
    const bLocation = b.nameLocation();
    if (aLocation === undefined || bLocation === undefined) return 0.5;
    return Math.min(
      1,
      Math.hypot(aLocation.x - bLocation.x, aLocation.y - bLocation.y) /
        Math.max(1, Math.hypot(this.game.width(), this.game.height())),
    );
  }

  private raidSuccessRate(): number {
    return this.learning.raidAttempts === 0
      ? 0.6
      : this.learning.raidSuccesses / this.learning.raidAttempts;
  }

  private retaliationRate(): number {
    return this.learning.raidAttempts === 0
      ? 0
      : this.learning.raidRetaliations / this.learning.raidAttempts;
  }

  private eliminationRate(): number {
    return this.learning.matches === 0
      ? 0
      : this.learning.eliminations / this.learning.matches;
  }

  private transportLossRate(): number {
    const resolved =
      this.learning.transportArrivals + this.learning.transportDestroyed;
    return resolved === 0 ? 0.1 : this.learning.transportDestroyed / resolved;
  }

  private predictionQuality(): number {
    const samples = Math.max(1, this.learning.predictionCount);
    return (
      this.learning.predictionReward / samples -
      this.learning.predictionError / samples
    );
  }

  private learnedRaidCooldown(
    raid: NonNullable<VisualAiTrainer["activeRaid"]>,
  ): number {
    const denialCooldown = Math.round(
      Math.max(
        140,
        Math.min(
          480,
          360 -
            this.raidSuccessRate() * 220 +
            this.retaliationRate() * 120 -
            this.activeGene("Aggression") * 80 +
            this.activeGene("Caution") * 80,
        ),
      ),
    );
    return raid.purpose === "denial"
      ? denialCooldown
      : Math.round(denialCooldown * 1.6);
  }

  private saveLearning(): void {
    this.learning.saveRevision++;
    this.learning.savedAt = Date.now();
    try {
      localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(this.learning));
    } catch {
      this.brainStorage = "Server backup pending · browser cache unavailable";
    }
    window.clearTimeout(this.remoteSaveTimer);
    this.remoteSaveTimer = window.setTimeout(
      () => void this.persistLearning(),
      250,
    );
  }

  private async restoreLearning(): Promise<void> {
    let restoredServerCopy = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch("/api/ai-training/brain", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`brain API returned ${response.status}`);
      const payload = (await response.json()) as {
        brain?: { profile?: unknown } | null;
      };
      if (payload.brain?.profile !== undefined) {
        const serverLearning = normalizeLearning(payload.brain.profile);
        if (
          serverLearning.savedAt > this.learning.savedAt ||
          (serverLearning.savedAt === this.learning.savedAt &&
            serverLearning.saveRevision > this.learning.saveRevision)
        ) {
          Object.assign(this.learning, serverLearning);
          localStorage.setItem(
            LEARNING_STORAGE_KEY,
            JSON.stringify(this.learning),
          );
          restoredServerCopy = true;
        }
      }
      this.brainStorage = restoredServerCopy
        ? "Server brain restored · browser cache refreshed"
        : "Browser + atomic server backup connected";
    } catch {
      this.brainStorage = "Browser cache only · server backup unavailable";
    } finally {
      window.clearTimeout(timeout);
    }

    this.prepareMutation();
    this.brainReady = true;
    this.setDecision(
      restoredServerCopy || this.learning.raidAttempts > 0
        ? "Loaded learned policy"
        : "New learning brain ready",
      `Generation ${this.learning.mutationGeneration} is ready at MAX speed. ${Math.round(this.raidSuccessRate() * 100)}% of earlier probes gained their target land; ${Math.round(this.retaliationRate() * 100)}% triggered retaliation.`,
    );
  }

  private async persistLearning(keepalive = false): Promise<void> {
    try {
      const response = await fetch("/api/ai-training/brain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: this.learning }),
        keepalive,
      });
      if (!response.ok)
        throw new Error(`brain API returned ${response.status}`);
      const payload = (await response.json()) as {
        brain?: { profile?: { saveRevision?: number } };
      };
      const serverRevision = payload.brain?.profile?.saveRevision ?? -1;
      this.brainStorage =
        serverRevision > this.learning.saveRevision
          ? "Newer server brain protected"
          : `Browser + server saved · revision ${this.learning.saveRevision}`;
      this.render(this.game.myPlayer());
    } catch {
      this.brainStorage = "Browser cache only · server backup retry pending";
      this.render(this.game.myPlayer());
    }
  }

  private predictionAction(decision: string): PredictionAction {
    const normalized = decision.toLowerCase();
    if (normalized.includes("attack") || normalized.includes("conquer"))
      return "attack";
    if (normalized.includes("expand") || normalized.includes("wilderness"))
      return "expand";
    if (normalized.includes("fleet") || normalized.includes("warship"))
      return "fleet";
    if (normalized.includes("defend") || normalized.includes("fortif"))
      return "defend";
    return "hold";
  }

  private settleActionPredictions(player: PlayerView | null): void {
    if (player === null) return;
    const currentTick = this.game.ticks();
    for (let index = this.pendingPredictions.length - 1; index >= 0; index--) {
      const entry = this.pendingPredictions[index];
      if (player.isAlive() && currentTick < (entry.settleTick ?? entry.tick))
        continue;
      this.pendingPredictions.splice(index, 1);
      entry.actualTroops = player.troops();
      entry.actualTiles = player.numTilesOwned();
      const troopError =
        Math.abs(entry.actualTroops - entry.expectedTroops) /
        Math.max(1, this.game.config().maxTroops(player));
      const tileError =
        Math.abs(entry.actualTiles - entry.expectedTiles) /
        Math.max(1, entry.expectedTiles);
      entry.error = Math.min(2, troopError + tileError);
      this.learning.predictionError += entry.error;
      this.learning.predictionReward += Math.max(-1, 1 - entry.error);
      this.learning.predictionCount++;
      const outcome = {
        action: entry.action,
        startingTroops:
          entry.startingTroops ??
          entry.reserveRatio * this.game.config().maxTroops(player),
        endingTroops: entry.actualTroops,
        maxTroops:
          entry.startingMaxTroops ?? this.game.config().maxTroops(player),
        startingTiles: entry.startingTiles ?? entry.expectedTiles,
        endingTiles: entry.actualTiles,
        startingGold: entry.startingGold ?? 0,
        endingGold: Number(player.gold()),
        survived: player.isAlive(),
      };
      const absoluteReward = scoreDelayedActionOutcome(outcome);
      const counterfactualReward = scoreCounterfactualActionOutcome({
        ...outcome,
        expectedTroops: entry.expectedTroops,
        expectedTiles: entry.expectedTiles,
      });
      entry.outcomeReward = Math.max(
        -1,
        Math.min(1, absoluteReward * 0.3 + counterfactualReward * 0.7),
      );
      const normalizedReward = normalizeActionReward(
        entry.outcomeReward,
        this.learning.actionRewardBaselines[entry.action],
      );
      this.learning.actionRewardBaselines[entry.action] =
        normalizedReward.baseline;
      const learned = applyActionOutcomeLearning(
        {
          aggression: this.activeGene("Aggression"),
          caution: this.activeGene("Caution"),
          naval: this.activeGene("Naval"),
        },
        entry.action,
        normalizedReward.learningSignal,
        this.learning.actionOutcomeSamples,
        entry.attributionWeight,
      );
      if (this.learning.candidateActive === 1) {
        this.learning.candidateAggressionGene = learned.aggression;
        this.learning.candidateCautionGene = learned.caution;
        this.learning.candidateNavalGene = learned.naval;
      } else {
        this.learning.aggressionGene = learned.aggression;
        this.learning.cautionGene = learned.caution;
        this.learning.navalGene = learned.naval;
      }
      this.learning.actionOutcomeSamples++;
      this.learning.actionOutcomeReward += entry.outcomeReward;
      this.predictionSamples++;
      if (this.predictionSamples % 16 === 0) this.saveLearning();
    }
  }

  private recordActionPrediction(decision: string): void {
    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) return;
    const hostileTroops = this.game
      .players()
      .filter(
        (candidate) =>
          candidate !== player &&
          candidate.isAlive() &&
          !player.isFriendly(candidate),
      )
      .reduce((max, candidate) => Math.max(max, candidate.troops()), 0);
    const action = this.predictionAction(decision);
    const samples = predictFutureOutcomes({
      action,
      troops: player.troops(),
      maxTroops: this.game.config().maxTroops(player),
      tiles: player.numTilesOwned(),
      enemyTroops: hostileTroops,
      horizon: this.adaptivePlanningForecastHorizonTicks,
    });
    const expectedTroops =
      samples.reduce((sum, sample) => sum + sample.expectedTroops, 0) /
      samples.length;
    const expectedTiles =
      samples.reduce((sum, sample) => sum + sample.expectedTiles, 0) /
      samples.length;
    const entry: ActionHistoryEntry = {
      tick: this.game.ticks(),
      action,
      reserveRatio:
        player.troops() / Math.max(1, this.game.config().maxTroops(player)),
      enemyRatio: hostileTroops / Math.max(1, player.troops()),
      expectedTroops,
      expectedTiles,
      startingGold: Number(player.gold()),
      startingTiles: player.numTilesOwned(),
      startingTroops: player.troops(),
      startingMaxTroops: this.game.config().maxTroops(player),
      settleTick: this.game.ticks() + this.adaptivePlanningForecastHorizonTicks,
      attributionWeight:
        0.5 + 0.5 / Math.sqrt(this.pendingPredictions.length + 1),
    };
    this.learning.actionHistory.push(entry);
    this.learning.actionHistory = this.learning.actionHistory.slice(-128);
    this.pendingPredictions.push(entry);
    if (this.pendingPredictions.length > 16) this.pendingPredictions.shift();
  }

  private prepareMutation(): void {
    if (this.learning.candidateActive === 1) return;
    this.learning.candidateAggressionGene = this.learning.aggressionGene;
    this.learning.candidateCautionGene = this.learning.cautionGene;
    this.learning.candidateNavalGene = this.learning.navalGene;
    const genes = [
      "candidateAggressionGene",
      "candidateCautionGene",
      "candidateNavalGene",
    ] as const;
    const mutate = (gene: (typeof genes)[number], scale = 1) => {
      const direction = Math.random() < 0.5 ? -1 : 1;
      const step = (0.08 + Math.random() * 0.17) * direction * scale;
      this.learning[gene] = Math.max(
        -1,
        Math.min(1, this.learning[gene] + step),
      );
    };
    mutate(genes[Math.floor(Math.random() * genes.length)]);
    if (Math.random() < 0.3) {
      mutate(genes[Math.floor(Math.random() * genes.length)], 0.5);
    }
    const bias = (gene: (typeof genes)[number], amount: number) => {
      this.learning[gene] = Math.max(
        -1,
        Math.min(1, this.learning[gene] + amount),
      );
    };
    switch (this.learning.lastLossCause) {
      case LossCause.Overextension:
        bias("candidateCautionGene", 0.1);
        bias("candidateAggressionGene", -0.06);
        break;
      case LossCause.ThirdParty:
        bias("candidateCautionGene", 0.08);
        break;
      case LossCause.StalledOffense:
        bias("candidateAggressionGene", -0.05);
        bias("candidateNavalGene", 0.05);
        break;
      case LossCause.Containment:
        bias("candidateAggressionGene", 0.08);
        bias("candidateNavalGene", 0.08);
        bias("candidateCautionGene", -0.08);
        break;
      case LossCause.Infrastructure:
        bias("candidateCautionGene", 0.06);
        break;
      case LossCause.Unknown:
        break;
    }
    this.learning.candidateBaselineScore = this.learning.bestMutationScore;
    this.learning.candidateActive = 1;
    this.learning.candidateSeedScoreTotal = 0;
    this.learning.candidateSeedMatches = 0;
    this.learning.mutationGeneration++;
    this.saveLearning();
  }

  private evaluateMutation(score: number): void {
    if (this.learning.candidateActive !== 1) return;
    const cohort = evaluateSeedCohort({
      scoreTotal: this.learning.candidateSeedScoreTotal ?? 0,
      completedSeeds: this.learning.candidateSeedMatches ?? 0,
      nextScore: score,
      requiredSeeds: MUTATION_SEED_COHORT_SIZE,
      baselineScore: this.learning.candidateBaselineScore,
      firstGeneration: this.learning.mutationGeneration === 1,
    });
    this.learning.candidateSeedScoreTotal = cohort.scoreTotal;
    this.learning.candidateSeedMatches = cohort.completedSeeds;
    if (!cohort.complete) return;
    if (cohort.accepted === true) {
      this.learning.aggressionGene = this.learning.candidateAggressionGene;
      this.learning.cautionGene = this.learning.candidateCautionGene;
      this.learning.navalGene = this.learning.candidateNavalGene;
      this.learning.bestMutationScore = cohort.averageScore;
    }
    this.learning.candidateActive = 0;
    this.learning.candidateSeedScoreTotal = 0;
    this.learning.candidateSeedMatches = 0;
  }

  private activeGene(gene: "Aggression" | "Caution" | "Naval"): number {
    switch (gene) {
      case "Aggression":
        return this.learning.candidateActive === 1
          ? this.learning.candidateAggressionGene
          : this.learning.aggressionGene;
      case "Caution":
        return this.learning.candidateActive === 1
          ? this.learning.candidateCautionGene
          : this.learning.cautionGene;
      case "Naval":
        return this.learning.candidateActive === 1
          ? this.learning.candidateNavalGene
          : this.learning.navalGene;
    }
  }

  private decayOldLearning(): void {
    if (this.learning.raidAttempts > 200) {
      this.learning.raidAttempts = Math.round(
        this.learning.raidAttempts * 0.75,
      );
      this.learning.raidSuccesses = Math.round(
        this.learning.raidSuccesses * 0.75,
      );
      this.learning.raidRetaliations = Math.round(
        this.learning.raidRetaliations * 0.75,
      );
    }
    const resolvedTransports =
      this.learning.transportArrivals + this.learning.transportDestroyed;
    if (resolvedTransports > 200) {
      this.learning.transportArrivals = Math.round(
        this.learning.transportArrivals * 0.75,
      );
      this.learning.transportDestroyed = Math.round(
        this.learning.transportDestroyed * 0.75,
      );
    }
    // Lifetime outcomes and the recent result ledger are authoritative
    // scorecard data. Never decay them alongside rate-estimation samples.
  }

  private async tryLaunchReserveFleet(
    player: PlayerView,
    adjacentEnemies: Map<string, PlayerView>,
  ): Promise<boolean> {
    if (!this.choiceAllowed("naval")) return false;
    const maxTroops = this.game.config().maxTroops(player);
    const reserveRatio = player.troops() / maxTroops;
    const currentTransports = player.units(UnitType.TransportShip);
    const fleetTroops = currentTransports.reduce(
      (sum, transport) => sum + transport.troops(),
      0,
    );
    if (
      this.game.ticks() < this.nextBoatTick ||
      reserveRatio <
        minimumNavalLaunchReserveRatio(
          this.game.ticks(),
          this.game.config().armyLimitWarningThreshold(),
        ) ||
      currentTransports.length >= this.game.config().boatMaxNumber()
    ) {
      return false;
    }

    const eligibleDistantTargets = this.game
      .players()
      .filter(
        (candidate) =>
          candidate !== player &&
          candidate.isAlive() &&
          (candidate.type() === PlayerType.Bot ||
            (candidate.type() === PlayerType.Nation &&
              player.outgoingAttacks().length < 2)) &&
          !player.isFriendly(candidate) &&
          !adjacentEnemies.has(candidate.id()),
      );
    const distantTargets = preferTribeExpansionTargets(
      eligibleDistantTargets.map((candidate) => ({
        candidate,
        isTribe: candidate.type() === PlayerType.Bot,
        earlyPortOpportunity:
          earlyPortSeizureValue({
            ticks: this.game.ticks(),
            enemyPorts: candidate.units(UnitType.Port).length,
            enemyWarships: candidate.units(UnitType.Warship).length,
            enemyToOwnTroopRatio:
              candidate.troops() / Math.max(1, player.troops()),
          }) > 0,
        navalRemnantOpportunity: isNavalRemnantOpportunity({
          ownTroops: player.troops(),
          ownTiles: player.numTilesOwned(),
          targetTroops: candidate.troops(),
          targetTiles: candidate.numTilesOwned(),
          targetIsAllied: player.isFriendly(candidate),
        }),
      })),
    )
      .map((candidate) => ({
        candidate: candidate.candidate,
        value:
          overseasExpansionValue({
            landTiles: candidate.candidate.numTilesOwned(),
            ports: candidate.candidate.units(UnitType.Port).length,
            troopDensity:
              candidate.candidate.troops() /
              Math.max(1, candidate.candidate.numTilesOwned()),
            normalizedDistance: this.normalizedPlayerDistance(
              player,
              candidate.candidate,
            ),
            isTribe: candidate.isTribe,
            opensNationWar: candidate.candidate.type() === PlayerType.Nation,
          }) +
          earlyPortSeizureValue({
            ticks: this.game.ticks(),
            enemyPorts: candidate.candidate.units(UnitType.Port).length,
            enemyWarships: candidate.candidate.units(UnitType.Warship).length,
            enemyToOwnTroopRatio:
              candidate.candidate.troops() / Math.max(1, player.troops()),
          }) +
          (candidate.navalRemnantOpportunity ? 90 : 0),
      }))
      .sort((a, b) => b.value - a.value)
      .map(({ candidate }) => candidate);
    if (distantTargets.length === 0) return false;

    const hostileWarships = this.game
      .units(UnitType.Warship)
      .filter(
        (warship) =>
          warship.owner() !== player && !player.isFriendly(warship.owner()),
      );
    const ownWarships = player.units(UnitType.Warship);
    const fleetBankTarget = desiredFleetTroopBank({
      maxTroops,
      nearbyHostileWarships: hostileWarships.length,
      ownWarships: ownWarships.length,
      hasTradeTarget: distantTargets.length > 0,
    });
    const hasNavalRemnant = distantTargets.some((target) =>
      isNavalRemnantOpportunity({
        ownTroops: player.troops(),
        ownTiles: player.numTilesOwned(),
        targetTroops: target.troops(),
        targetTiles: target.numTilesOwned(),
        targetIsAllied: player.isFriendly(target),
      }),
    );
    if (fleetTroops >= fleetBankTarget && !hasNavalRemnant) return false;
    let bestRejectedPlan:
      | {
          risk: number;
          expectedGain: number;
          reason: string;
        }
      | undefined;
    let bestPlan:
      | {
          target: PlayerView;
          destination: number;
          launchTroops: number;
          projectedTargetTroops: number;
          bridgehead: boolean;
          bridgeheadReachGain: number;
          etaTicks: number;
          interceptionRisk: number;
          regenerationGain: number;
          expectedGain: number;
          terrainLabel: string;
          terrainMultiplier: number;
          hasDefensePost: boolean;
          hasFallout: boolean;
          passableExits: number;
          nearbyPorts: number;
          earlyPortSeizure: boolean;
          waterLabel: string;
          score: number;
        }
      | undefined;

    const reserveFloor = Math.max(maxTroops * 0.55, fleetBankTarget);
    const maximumLaunchTroops = Math.floor(
      Math.min(
        player.troops() *
          (hostileWarships.length > ownWarships.length ? 0.16 : 0.25),
        player.troops() - reserveFloor,
      ),
    );
    if (maximumLaunchTroops < maxTroops * 0.02) return false;
    const maxInterceptionRisk = maximumNavalInterceptionRisk({
      transportLossRate: this.transportLossRate(),
      navalGene: this.activeGene("Naval"),
      cautionGene: this.activeGene("Caution"),
      noLandFront: adjacentEnemies.size === 0,
      reserveRatio,
    });

    for (const target of distantTargets.slice(0, 4)) {
      const targetIsRemnant = isNavalRemnantOpportunity({
        ownTroops: player.troops(),
        ownTiles: player.numTilesOwned(),
        targetTroops: target.troops(),
        targetTiles: target.numTilesOwned(),
        targetIsAllied: player.isFriendly(target),
      });
      const hostileReachGain = this.game
        .players()
        .filter(
          (candidate) =>
            candidate !== player &&
            candidate !== target &&
            candidate.isAlive() &&
            candidate.type() === PlayerType.Nation &&
            !player.isFriendly(candidate),
        )
        .reduce(
          (best, candidate) =>
            Math.max(
              best,
              this.normalizedPlayerDistance(player, candidate) -
                this.normalizedPlayerDistance(target, candidate),
            ),
          0,
        );
      const alliedLinkGain = player
        .alliances()
        .map((alliance) => this.game.player(alliance.other))
        .filter((ally) => ally.isAlive())
        .reduce(
          (best, ally) =>
            Math.max(
              best,
              (this.normalizedPlayerDistance(player, ally) -
                this.normalizedPlayerDistance(target, ally)) *
                0.5,
            ),
          0,
        );
      const bridgeheadReachGain = Math.max(0, hostileReachGain, alliedLinkGain);
      const targetBorders = await target.borderTiles();
      const targetPortTiles = target
        .units(UnitType.Port)
        .map((port) => port.tile())
        .filter(
          (tile) => this.game.isShore(tile) && !this.game.isImpassable(tile),
        );
      const targetShores = [...targetBorders.borderTiles].filter(
        (tile) => this.game.isShore(tile) && !this.game.isImpassable(tile),
      );
      const sampledShores = prioritizePortLandingTiles(
        targetShores,
        targetPortTiles,
        8,
      );
      for (const destination of sampledShores) {
        const source = await player.bestTransportShipSpawn(destination);
        if (source === false) continue;
        const etaTicks = Math.max(
          1,
          Math.ceil(
            Math.hypot(
              this.game.x(destination) - this.game.x(source),
              this.game.y(destination) - this.game.y(source),
            ),
          ),
        );
        const visibleRisk = this.routeInterceptionRisk(
          source,
          destination,
          etaTicks,
          hostileWarships,
        );
        const waterLabel = this.game.isOceanShore(destination)
          ? "ocean coast"
          : "inland-water coast";
        const unknownFleetRisk = Math.min(
          0.2,
          (this.game.isOceanShore(destination) ? 0.03 : 0.01) +
            (target.type() === PlayerType.Nation ? 0.06 : 0) +
            target.units(UnitType.Port).length * 0.025,
        );
        const interceptionRisk = 1 - (1 - visibleRisk) * (1 - unknownFleetRisk);
        const terrain = this.landingTerrain(destination, target);
        const nearbyPorts = target
          .units(UnitType.Port)
          .filter(
            (port) =>
              this.game.euclideanDistSquared(destination, port.tile()) <=
              this.game.config().trainStationMaxRange() ** 2,
          ).length;
        const earlyPortSeizure =
          this.game.ticks() < 2_000 &&
          target.units(UnitType.Warship).length === 0 &&
          nearbyPorts > 0;
        const requiredLandingAdvantage =
          (target.type() === PlayerType.Bot ? 1.05 : 1.35) *
          terrain.lossMultiplier *
          (terrain.hasDefensePost
            ? this.game.config().defensePostDefenseBonus()
            : 1);
        const projectedTargetTroops = this.projectRegeneration(
          target.troops(),
          Math.max(1, this.game.config().maxTroops(target)),
          etaTicks,
        );
        const bridgehead = assessBridgeheadLaunch({
          projectedEnemyTroops: projectedTargetTroops,
          requiredLandingAdvantage,
          normalMinimumLaunchTroops: maxTroops * 0.08,
          bridgeheadMinimumLaunchTroops: maxTroops * 0.02,
          maximumLaunchTroops,
          reachGain: bridgeheadReachGain,
          interceptionRisk,
          passableExits: terrain.passableExits,
          targetIsTribe: target.type() === PlayerType.Bot,
          targetIsRemnant,
        });
        const launchTroops = bridgehead.launchTroops;
        const regeneratedTroops = this.projectRegeneration(
          player.troops() - launchTroops,
          maxTroops,
          etaTicks,
        );
        const regenerationGain =
          regeneratedTroops - (player.troops() - launchTroops);
        const expectedGain = regenerationGain - interceptionRisk * launchTroops;
        const landingAdvantage =
          launchTroops / Math.max(1, projectedTargetTroops);
        const rejectionReason =
          launchTroops <= 0
            ? bridgehead.reason
            : interceptionRisk > maxInterceptionRisk
              ? `interception risk exceeds the learned ${Math.round(maxInterceptionRisk * 100)}% limit`
              : landingAdvantage < requiredLandingAdvantage
                ? `the ${terrain.label} landing requires ${requiredLandingAdvantage.toFixed(2)}× force`
                : expectedGain <= 0
                  ? "expected ship losses exceed regenerated overflow"
                  : null;
        if (rejectionReason !== null) {
          if (
            bestRejectedPlan === undefined ||
            expectedGain > bestRejectedPlan.expectedGain
          ) {
            bestRejectedPlan = {
              risk: interceptionRisk,
              expectedGain,
              reason: rejectionReason,
            };
          }
          continue;
        }
        const score =
          expectedGain +
          (target.type() === PlayerType.Bot ? launchTroops * 0.15 : 0) +
          launchTroops *
            0.2 *
            (landingAdvantage / requiredLandingAdvantage - 1) +
          terrain.passableExits * maxTroops * 0.002 +
          bridgehead.reachValue * maxTroops * 0.002;
        const expansionScore =
          score +
          nearbyPorts * maxTroops * 0.015 +
          (earlyPortSeizure ? maxTroops * 0.04 : 0) +
          Math.log2(1 + target.numTilesOwned()) * maxTroops * 0.001;
        if (bestPlan === undefined || expansionScore > bestPlan.score) {
          bestPlan = {
            target,
            destination,
            launchTroops,
            projectedTargetTroops,
            bridgehead: bridgehead.bridgehead,
            bridgeheadReachGain,
            etaTicks,
            interceptionRisk,
            regenerationGain,
            expectedGain,
            terrainLabel: terrain.label,
            terrainMultiplier:
              terrain.lossMultiplier *
              (terrain.hasDefensePost
                ? this.game.config().defensePostDefenseBonus()
                : 1),
            hasDefensePost: terrain.hasDefensePost,
            hasFallout: terrain.hasFallout,
            passableExits: terrain.passableExits,
            nearbyPorts,
            earlyPortSeizure,
            waterLabel,
            score: expansionScore,
          };
        }
      }
    }

    if (bestPlan !== undefined) {
      const fraction = bestPlan.launchTroops / player.troops();
      this.eventBus.emit(new AttackRatioEvent(fraction));
      this.eventBus.emit(new SendTargetPlayerIntentEvent(bestPlan.target.id()));
      this.eventBus.emit(
        new SendBoatAttackIntentEvent(
          bestPlan.destination,
          bestPlan.launchTroops,
        ),
      );
      this.nextBoatTick =
        this.game.ticks() +
        navalLaunchDelayTicks({
          maximumTransports: this.game.config().boatMaxNumber(),
          activeTransports: currentTransports.length + 1,
          transportLossRate: this.transportLossRate(),
          earlyExpansion: this.game.ticks() < 2_500,
          isTribe: bestPlan.target.type() === PlayerType.Bot,
        });
      this.followTransportUntil = this.game.ticks() + 140;
      this.nextTransportCameraTick = this.game.ticks() + 1;
      this.follow(bestPlan.target, 5);
      this.setDecision(
        bestPlan.bridgehead
          ? `Establish a forward bridgehead near ${bestPlan.target.name()}`
          : bestPlan.earlyPortSeizure
            ? `Seize an undefended port from ${bestPlan.target.name()}`
            : `Launch tile-aware fleet toward ${bestPlan.target.name()}`,
        `${Math.round(fraction * 100)}% launches toward a ${bestPlan.terrainLabel} ${bestPlan.waterLabel} with ${bestPlan.passableExits} passable exits and ${bestPlan.nearbyPorts} nearby port${bestPlan.nearbyPorts === 1 ? "" : "s"}${bestPlan.hasDefensePost ? ", a defense post penalty" : ""}${bestPlan.hasFallout ? ", and fallout" : ""}. The defender is projected to reach ${renderTroops(bestPlan.projectedTargetTroops)} by the ${(bestPlan.etaTicks / 10).toFixed(1)}s landing; future-route reach improves by ${Math.round(bestPlan.bridgeheadReachGain * 100)}%. Landing defense ×${bestPlan.terrainMultiplier.toFixed(2)}; regeneration +${renderTroops(bestPlan.regenerationGain)}; interception risk ${Math.round(bestPlan.interceptionRisk * 100)}%; expected overflow gain +${renderTroops(bestPlan.expectedGain)}.`,
      );
      return true;
    }

    if (bestRejectedPlan !== undefined) {
      this.nextBoatTick =
        this.game.ticks() +
        navalLaunchDelayTicks({
          maximumTransports: this.game.config().boatMaxNumber(),
          activeTransports: currentTransports.length,
          transportLossRate: this.transportLossRate(),
          earlyExpansion: this.game.ticks() < 2_500,
          isTribe: true,
        });
      this.setDecision(
        "Reject the best reserve-fleet route",
        `${bestRejectedPlan.reason}; risk ${Math.round(bestRejectedPlan.risk * 100)}%, expected overflow value ${renderTroops(bestRejectedPlan.expectedGain)}. A transport is a priority one-shot target, so all carried troops remain at risk.`,
      );
      return false;
    }
    return false;
  }

  private analyzeNavalSituation(
    player: PlayerView,
    borderTiles: ReadonlySet<number>,
  ): NavalSituation {
    const ownedShores = [...borderTiles].filter(
      (tile) => this.game.isShore(tile) && !this.game.isImpassable(tile),
    );
    const shoreSampleRatio = Math.max(
      0.12,
      Math.min(0.35, 0.12 + this.activeGene("Naval") * 0.12),
    );
    const sampleCount = Math.min(
      96,
      Math.max(1, Math.ceil(ownedShores.length * shoreSampleRatio)),
    );
    const sampledShores =
      ownedShores.length <= sampleCount
        ? ownedShores
        : Array.from(
            { length: sampleCount },
            (_, index) =>
              ownedShores[
                Math.floor(
                  (index * (ownedShores.length - 1)) /
                    Math.max(1, sampleCount - 1),
                )
              ],
          );
    const isHostile = (owner: PlayerView) =>
      owner !== player && !player.isFriendly(owner);
    const coastalAwarenessRatio =
      1.25 + Math.min(0.35, this.activeGene("Naval") * 0.2);
    const threatRange =
      this.game.config().warshipTargettingRange() * coastalAwarenessRatio;
    const nearbyHostileNavalUnits = new Map<
      number,
      ReturnType<GameView["units"]>[number]
    >();
    for (const shore of sampledShores) {
      for (const { unit } of this.game.nearbyUnits(
        shore,
        threatRange,
        [UnitType.Warship, UnitType.TransportShip],
        ({ unit }) => isHostile(unit.owner() as PlayerView),
      )) {
        nearbyHostileNavalUnits.set(unit.id(), unit);
      }
    }
    const hostileWarships = [...nearbyHostileNavalUnits.values()].filter(
      (unit) => unit.type() === UnitType.Warship,
    );
    const hostileTransports = [...nearbyHostileNavalUnits.values()].filter(
      (unit) => unit.type() === UnitType.TransportShip,
    );
    const tradeTargets = this.game
      .units(UnitType.TradeShip)
      .filter((unit) => isHostile(unit.owner()));
    const ownWarships = player.units(UnitType.Warship).length;
    const weightedHostiles =
      hostileWarships.length + hostileTransports.length * 0.75;
    const navalPressureRatio =
      weightedHostiles / Math.max(1, weightedHostiles + ownWarships + 1);
    const hostilePlayers = this.game
      .players()
      .filter(
        (candidate) => candidate.isAlive() && isHostile(candidate),
      ).length;
    const tradeOpportunityRatio = Math.min(
      1,
      tradeTargets.length / Math.max(1, hostilePlayers),
    );

    return {
      ownedShores: sampledShores,
      hostileWarships,
      hostileTransports,
      tradeTargets,
      navalPressureRatio,
      tradeOpportunityRatio,
    };
  }

  private async tryNavalControl(
    player: PlayerView,
    borderTiles: ReadonlySet<number>,
    currentSituation?: NavalSituation,
  ): Promise<boolean> {
    if (!this.choiceAllowed("naval")) return false;
    const situation =
      currentSituation ?? this.analyzeNavalSituation(player, borderTiles);
    const sampledShores = situation.ownedShores;
    if (sampledShores.length === 0) return false;
    const distanceToCoast = (tile: number) =>
      Math.sqrt(
        Math.min(
          ...sampledShores.map((shore) =>
            this.game.euclideanDistSquared(tile, shore),
          ),
        ),
      );
    const threatRange =
      this.game.config().warshipTargettingRange() *
      (1.25 + Math.min(0.35, this.activeGene("Naval") * 0.2));
    const hostileWarships = situation.hostileWarships;
    const hostileTransports = situation.hostileTransports;
    const tradeTargets = situation.tradeTargets;
    const desiredFleet = desiredWarshipCount({
      nearbyHostileWarships: hostileWarships.length,
      nearbyHostileTransports: hostileTransports.length,
      vulnerableTradeShips: tradeTargets.length,
      navalBias: this.activeGene("Naval"),
    });
    if (desiredFleet === 0) return false;

    const defenseTarget = [...hostileTransports, ...hostileWarships].sort(
      (a, b) => distanceToCoast(a.tile()) - distanceToCoast(b.tile()),
    )[0];
    const tradeTarget = tradeTargets.sort(
      (a, b) => distanceToCoast(a.tile()) - distanceToCoast(b.tile()),
    )[0];
    const target = defenseTarget ?? tradeTarget;
    if (target === undefined) return false;
    const economicOnly = defenseTarget === undefined;
    const portAction = this.moduleSignals.portAction ?? "hold";
    const portUrgency = this.moduleSignals.portActionUrgency ?? 0;
    const candidateSampleRatio =
      this.moduleSignals.portCandidateSampleRatio ?? 0.2;
    const targetCoverageRatio =
      this.moduleSignals.portTargetCoverageRatio ?? 0.35;
    const minimumBudgetCoverage =
      this.moduleSignals.portMinimumBudgetCoverage ?? 1;
    const constructionPressure =
      this.moduleSignals.portConstructionPressure ?? portUrgency;
    if (
      economicOnly &&
      portAction !== "trade" &&
      player.units(UnitType.Warship).length > 0
    ) {
      return false;
    }

    const ports = player.units(UnitType.Port);
    const ownWarships = player.units(UnitType.Warship);
    const dockCapacity = ports.reduce((sum, port) => sum + port.level(), 0);
    const maxWarshipHealth =
      this.game.unitInfo(UnitType.Warship).maxHealth ?? 1;
    const veterancyHealthBonus = this.game
      .config()
      .warshipVeterancyHealthBonus();
    const veterancyDamageBonus = this.game
      .config()
      .warshipVeterancyShellDamageBonus();
    const repairHealthThreshold =
      this.moduleSignals.portRepairHealthThreshold ?? 0.8;
    const damagedWarships = ownWarships.filter(
      (warship) =>
        warship.hasHealth() &&
        warshipHealthRatio(
          warship.health(),
          maxWarshipHealth,
          warship.veterancy(),
          veterancyHealthBonus,
        ) < repairHealthThreshold,
    );
    const warshipPlan =
      ports.length === 0
        ? undefined
        : (await player.buildables(target.tile(), [UnitType.Warship]))[0];
    const lacksReachablePort =
      ports.length === 0 ||
      warshipPlan?.canBuild === false ||
      warshipPlan?.canBuild === undefined;
    const portBuildAction = portAction === "defend" || portAction === "trade";
    if (lacksReachablePort && portBuildAction) {
      const factories = player
        .units(UnitType.Factory)
        .filter(
          (factory) => factory.isActive() && !factory.isUnderConstruction(),
        );
      const stationRange = this.game.config().trainStationMaxRange();
      const stationMinimumRange = this.game.config().trainStationMinRange();
      const shipyardNeighborhoodRange =
        stationRange * (0.5 + candidateSampleRatio);
      const shorelineSampleRange =
        this.game.config().structureMinDist() * (0.75 + portUrgency * 0.5);
      const candidateCount = Math.min(
        32,
        Math.max(1, Math.ceil(sampledShores.length * candidateSampleRatio)),
      );
      const candidateTiles = sampledShores
        .slice()
        .sort(
          (a, b) =>
            this.game.euclideanDistSquared(a, target.tile()) -
            this.game.euclideanDistSquared(b, target.tile()),
        )
        .slice(0, candidateCount);
      const siteByID = new Map(
        candidateTiles.map((tile) => {
          const distanceSquaredToFriendlyFactory = Math.min(
            ...factories.map((factory) =>
              this.game.euclideanDistSquared(tile, factory.tile()),
            ),
            1_000 ** 2,
          );
          const distanceToFriendlyFactory = Math.sqrt(
            distanceSquaredToFriendlyFactory,
          );
          const nearbyFriendlyShipyards = ports.filter(
            (port) =>
              this.game.euclideanDistSquared(tile, port.tile()) <=
              shipyardNeighborhoodRange ** 2,
          ).length;
          const nearbyEnemyWarships = hostileWarships.filter(
            (warship) =>
              this.game.euclideanDistSquared(tile, warship.tile()) <=
              threatRange ** 2,
          ).length;
          const id = String(tile);
          return [
            id,
            {
              id,
              shorelineLength: sampledShores.filter(
                (shore) =>
                  this.game.euclideanDistSquared(tile, shore) <=
                  shorelineSampleRange ** 2,
              ).length,
              openWaterDirections:
                this.game
                  .neighbors(tile)
                  .filter((neighbor) => this.game.isWater(neighbor)).length *
                1.5,
              nearbyFriendlyShipyards,
              nearbyEnemyWarships,
              distanceToCoastalTargets: Math.sqrt(
                this.game.euclideanDistSquared(tile, target.tile()),
              ),
              distanceToFriendlyFactory,
              railConnected: isWithinRailConnectionRange({
                distanceSquared: distanceSquaredToFriendlyFactory,
                minimumRange: stationMinimumRange,
                maximumRange: stationRange,
              }),
              threatenedBorderPressure: Math.min(
                1,
                nearbyEnemyWarships / Math.max(1, desiredFleet),
              ),
              projectedWarshipThroughput: Math.max(
                1,
                desiredFleet - ownWarships.length,
              ),
              marginalStackValue:
                Math.max(0, damagedWarships.length - dockCapacity) /
                Math.max(1, nearbyFriendlyShipyards + 1),
            },
          ] as const;
        }),
      );
      const hasFactoryConnectedSite = [...siteByID.values()].some(
        (site) => site.railConnected,
      );
      const requireFactoryConnection =
        this.moduleSignals.portRequireFactoryConnection === true;
      const placement = planShipyardPlacements({
        goldSurplusRatio: this.moduleSignals.portBudgetCoverageRatio ?? 0,
        existingShipyards: 0,
        coastalTargets:
          hostileWarships.length +
          hostileTransports.length +
          tradeTargets.length,
        maximumPlacements: Math.max(
          1,
          Math.ceil(candidateTiles.length * targetCoverageRatio),
        ),
        allowStacking: this.moduleSignals.allowProductiveStacking === true,
        requireFactoryConnection:
          requireFactoryConnection && hasFactoryConnectedSite,
        urgency: portUrgency,
        targetCoverageRatio,
        minimumSiteQuality: this.moduleSignals.portMinimumSiteQuality ?? 0.5,
        stackingLoadRatio: this.moduleSignals.portRepairLoadRatio ?? 0,
        stackingLoadThreshold:
          this.moduleSignals.portStackingLoadThreshold ?? 1.2,
        sites: [...siteByID.values()],
      });
      const plannedTiles = placement.siteIDs
        .map((id) => Number(id))
        .filter((tile) => Number.isFinite(tile));
      const fallbackTiles = candidateTiles.sort((a, b) => {
        const aSite = siteByID.get(String(a));
        const bSite = siteByID.get(String(b));
        return (
          Number(bSite?.railConnected ?? false) -
            Number(aSite?.railConnected ?? false) ||
          (aSite?.distanceToFriendlyFactory ?? 1_000) -
            (bSite?.distanceToFriendlyFactory ?? 1_000) ||
          this.game.euclideanDistSquared(a, target.tile()) -
            this.game.euclideanDistSquared(b, target.tile())
        );
      });
      const portCandidates =
        plannedTiles.length > 0
          ? plannedTiles
          : requireFactoryConnection && hasFactoryConnectedSite
            ? []
            : fallbackTiles.slice(0, candidateCount);
      const portPlans = await Promise.all(
        portCandidates.map(async (tile) => ({
          tile,
          site: siteByID.get(String(tile)),
          plan: (await player.buildables(tile, [UnitType.Port]))[0],
        })),
      );
      const port = portPlans.find(
        ({ plan }) =>
          plan?.canBuild !== false &&
          plan?.canBuild !== undefined &&
          this.economicPlan !== undefined &&
          this.economicPlan.spendableGold / Math.max(1, Number(plan.cost)) >=
            minimumBudgetCoverage,
      );
      if (port?.plan.canBuild !== false && port?.plan.canBuild !== undefined) {
        this.eventBus.emit(
          new BuildUnitIntentEvent(UnitType.Port, port.plan.canBuild),
        );
        this.nextEconomicCostRefreshTick = 0;
        this.nextNavalConstructionTick = navalConstructionRetryTick(
          this.game.ticks(),
          "port",
          constructionPressure,
        );
        this.eventBus.emit(new GoToUnitEvent(target));
        const factoryLinked = port.site?.railConnected === true;
        this.setDecision(
          factoryLinked
            ? defenseTarget === undefined
              ? "Build a factory-linked shipyard for economic raiding"
              : "Build a factory-linked shipyard against naval pressure"
            : defenseTarget === undefined
              ? "Build a shipyard and queue its factory link"
              : "Build an emergency shipyard and queue its factory link",
          defenseTarget === undefined
            ? `A vulnerable trade ship is available. ${port.site?.railConnected ? "This shore tile is already inside a factory rail catchment, so the port activates as a train stop as well as a naval base." : "No legal factory-backed shore tile exists yet; the naval module has published a factory-connection follow-up."}`
            : `${hostileWarships.length} hostile warships and ${hostileTransports.length} transports are near the owned coast. ${port.site?.railConnected ? "The selected repair and launch base is inside factory range." : "The emergency site is unconnected, so the economic module will prioritize a factory link next."}`,
        );
        return true;
      }
    }

    const repairLoadRatio =
      this.moduleSignals.portRepairLoadRatio ??
      damagedWarships.length / Math.max(1, dockCapacity);
    const stackingLoadThreshold =
      this.moduleSignals.portStackingLoadThreshold ?? 1.2;
    const repairNeighborhoodRange =
      this.game.config().trainStationMaxRange() *
      (0.45 + targetCoverageRatio * 0.4);
    if (portAction === "repair" && repairLoadRatio >= stackingLoadThreshold) {
      const stackPortCandidates = sampledShores
        .map((tile) => ({
          tile,
          distance: Math.min(
            ...ports.map((port) =>
              Math.sqrt(this.game.euclideanDistSquared(tile, port.tile())),
            ),
          ),
        }))
        .filter(({ distance }) => distance <= repairNeighborhoodRange)
        .sort((a, b) => a.distance - b.distance)
        .slice(
          0,
          Math.min(
            12,
            Math.max(1, Math.ceil(sampledShores.length * candidateSampleRatio)),
          ),
        );
      const stackPortPlans = await Promise.all(
        stackPortCandidates.map(async ({ tile, distance }) => ({
          tile,
          distance,
          plan: (await player.buildables(tile, [UnitType.Port]))[0],
        })),
      );
      const stackPort = stackPortPlans.find(
        ({ plan }) =>
          plan?.canBuild !== false &&
          plan?.canBuild !== undefined &&
          this.economicPlan !== undefined &&
          this.economicPlan.spendableGold / Math.max(1, Number(plan.cost)) >=
            minimumBudgetCoverage,
      );
      if (
        stackPort?.plan.canBuild !== false &&
        stackPort?.plan.canBuild !== undefined
      ) {
        this.eventBus.emit(
          new BuildUnitIntentEvent(UnitType.Port, stackPort.plan.canBuild),
        );
        this.nextEconomicCostRefreshTick = 0;
        this.nextNavalConstructionTick = navalConstructionRetryTick(
          this.game.ticks(),
          "port",
          constructionPressure,
        );
        this.eventBus.emit(new GoToUnitEvent(target));
        this.setDecision(
          "Stack a naval repair port",
          `${Math.round(repairLoadRatio * 100)}% repair load exceeds the adaptive ${Math.round(stackingLoadThreshold * 100)}% stacking threshold. The selected site is within ${Math.round(repairNeighborhoodRange)} tiles of existing docks and adds proportional repair throughput.`,
        );
        return true;
      }
    }

    if (
      ownWarships.length < desiredFleet &&
      (portAction === "defend" || portAction === "trade") &&
      this.game.ticks() >= this.nextNavalConstructionTick
    ) {
      if (
        warshipPlan?.canBuild !== false &&
        warshipPlan?.canBuild !== undefined &&
        this.economicPlan !== undefined &&
        this.economicPlan.spendableGold >= Number(warshipPlan.cost)
      ) {
        this.eventBus.emit(
          new BuildUnitIntentEvent(UnitType.Warship, warshipPlan.canBuild),
        );
        // Construction is asynchronous. Yield long enough for the unit list
        // and gold state to change before attempting the same build again.
        this.nextNavalConstructionTick = navalConstructionRetryTick(
          this.game.ticks(),
          "warship",
          constructionPressure,
        );
        this.eventBus.emit(new GoToUnitEvent(target));
        this.setDecision(
          defenseTarget === undefined
            ? "Commission an economic-raiding warship"
            : "Commission a coastal-defense warship",
          defenseTarget === undefined
            ? `Fleet strength ${ownWarships.length}/${desiredFleet}: this ship will patrol the vulnerable trade route, capture economic traffic, and gain veterancy.`
            : `Fleet strength ${ownWarships.length}/${desiredFleet}: nearby pressure includes ${hostileWarships.length} warships and ${hostileTransports.length} troop transports.`,
        );
        return true;
      }
    }

    const availableWarships = ownWarships.filter(
      (warship) =>
        warship.warshipState().state === "patrolling" && !warship.isInCombat(),
    );
    const repositionTolerance =
      this.game.config().warshipTargettingRange() * (0.35 + portUrgency * 0.25);
    const deploymentRatio =
      defenseTarget === undefined
        ? targetCoverageRatio
        : Math.max(
            targetCoverageRatio,
            this.moduleSignals.portThreatRatio ?? 0,
          );
    const deploymentCount = Math.max(
      1,
      Math.ceil(availableWarships.length * Math.min(1, deploymentRatio)),
    );
    const repositionCandidates = availableWarships.filter(
      (warship) =>
        this.game.euclideanDistSquared(
          warship.warshipState().patrolTile ?? warship.tile(),
          target.tile(),
        ) >
        repositionTolerance ** 2,
    );
    const clashRadiusSquared = this.game.config().warshipTargettingRange() ** 2;
    const clashWarships =
      target.type() === UnitType.Warship
        ? hostileWarships.filter(
            (warship) =>
              this.game.euclideanDistSquared(warship.tile(), target.tile()) <=
              clashRadiusSquared,
          )
        : [];
    const targetPower =
      target.type() === UnitType.Warship
        ? fleetCombatPower(
            clashWarships.map((warship) => ({
              health: warship.health(),
              veterancy: warship.veterancy(),
            })),
            maxWarshipHealth,
            veterancyDamageBonus,
          )
        : 0.5;
    const candidateByID = new Map(
      repositionCandidates.map((warship) => [warship.id(), warship]),
    );
    const deployment = selectWarshipDeployment(
      repositionCandidates.map((warship) => ({
        id: warship.id(),
        health: warship.health(),
        veterancy: warship.veterancy(),
        distanceSquared: this.game.euclideanDistSquared(
          warship.tile(),
          target.tile(),
        ),
      })),
      targetPower,
      deploymentCount,
      target.type() === UnitType.Warship ? NAVAL_CLASH_ADVANTAGE : 0.7,
      maxWarshipHealth,
      veterancyHealthBonus,
      veterancyDamageBonus,
    );
    const shipsToMove = deployment
      .map((candidate) => candidateByID.get(candidate.id))
      .filter((warship) => warship !== undefined);
    if (shipsToMove.length > 0) {
      this.eventBus.emit(
        new MoveWarshipIntentEvent(
          shipsToMove.map((warship) => warship.id()),
          target.tile(),
        ),
      );
      this.eventBus.emit(new GoToUnitEvent(target));
      this.setDecision(
        defenseTarget === undefined
          ? "Raid a vulnerable trade route"
          : "Intercept a coastal naval threat",
        defenseTarget === undefined
          ? `A warship is moving its patrol circle onto enemy trade traffic, where captures steal gold and build veterancy.`
          : `${shipsToMove.length} healthy warship${shipsToMove.length === 1 ? " is" : "s are"} moving with veterancy-adjusted combat power to intercept before transports can land or hostile warships can control the coast.`,
      );
      return true;
    }

    return false;
  }

  private landingTerrain(
    destination: number,
    target: PlayerView,
  ): {
    label: string;
    multiplier: number;
    lossMultiplier: number;
    hasDefensePost: boolean;
    hasFallout: boolean;
    passableExits: number;
  } {
    const terrainType = this.game.terrainType(destination);
    let label: string;
    let multiplier: number;
    let lossMultiplier: number;
    switch (terrainType) {
      case TerrainType.Plains:
        label = "plains";
        multiplier = 1;
        lossMultiplier = 0.8;
        break;
      case TerrainType.Highland:
        label = "highland";
        multiplier = 20 / 16.5;
        lossMultiplier = 1;
        break;
      case TerrainType.Mountain:
        label = "mountain";
        multiplier = 25 / 16.5;
        lossMultiplier = 1.2;
        break;
      case TerrainType.Impassable:
        label = "impassable";
        multiplier = Number.POSITIVE_INFINITY;
        lossMultiplier = Number.POSITIVE_INFINITY;
        break;
      case TerrainType.Ocean:
        label = "invalid water";
        multiplier = Number.POSITIVE_INFINITY;
        lossMultiplier = Number.POSITIVE_INFINITY;
        break;
    }
    const hasDefensePost = this.game
      .nearbyUnits(
        destination,
        this.game.config().defensePostRange(),
        UnitType.DefensePost,
      )
      .some(({ unit }) => unit.owner() === target);
    const hasFallout = this.game.hasFallout(destination);
    if (hasFallout) {
      const falloutMultiplier = this.game
        .config()
        .falloutDefenseModifier(
          this.game.numTilesWithFallout() /
            Math.max(1, this.game.numLandTiles()),
        );
      multiplier *= falloutMultiplier;
      lossMultiplier *= falloutMultiplier;
    }
    const passableExits = this.game
      .neighbors(destination)
      .filter(
        (neighbor) =>
          this.game.isLand(neighbor) &&
          !this.game.isImpassable(neighbor) &&
          this.game.owner(neighbor) === target,
      ).length;
    return {
      label,
      multiplier,
      lossMultiplier,
      hasDefensePost,
      hasFallout,
      passableExits,
    };
  }

  private routeInterceptionRisk(
    source: number,
    destination: number,
    etaTicks: number,
    warships: ReturnType<GameView["units"]>,
  ): number {
    const sx = this.game.x(source);
    const sy = this.game.y(source);
    const dx = this.game.x(destination);
    const dy = this.game.y(destination);
    const vx = dx - sx;
    const vy = dy - sy;
    const lengthSquared = vx * vx + vy * vy;
    const targetingRange = this.game.config().warshipTargettingRange();
    const patrolClosingDistance = Math.min(100, etaTicks * 0.35);
    let survivalProbability = 1;

    for (const warship of warships) {
      const wx = this.game.x(warship.tile());
      const wy = this.game.y(warship.tile());
      const projection =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((wx - sx) * vx + (wy - sy) * vy) / lengthSquared),
            );
      const closestX = sx + projection * vx;
      const closestY = sy + projection * vy;
      const xDistance = wx - closestX;
      const yDistance = wy - closestY;
      const distance = Math.hypot(xDistance, yDistance);
      let risk = 0;
      if (distance <= targetingRange) {
        risk = 0.98;
      } else if (distance < targetingRange + patrolClosingDistance) {
        risk =
          0.75 *
          (1 -
            (distance - targetingRange) / Math.max(1, patrolClosingDistance));
      }
      survivalProbability *= 1 - risk;
    }
    return 1 - survivalProbability;
  }

  private projectRegeneration(
    startingTroops: number,
    maxTroops: number,
    ticks: number,
  ): number {
    let troops = startingTroops;
    for (let tick = 0; tick < ticks && troops < maxTroops; tick++) {
      const baseIncrease = 10 + Math.pow(troops, 0.73) / 4;
      const capacityRatio = 1 - troops / maxTroops;
      troops = Math.min(maxTroops, troops + baseIncrease * capacityRatio);
    }
    return troops;
  }

  private monitorTransportRisk(player: PlayerView | null): void {
    if (player === null) return;
    const transports = player.units(UnitType.TransportShip);
    const activeTransportIds = new Set(transports.map((unit) => unit.id()));
    for (const id of this.retreatingTransports) {
      if (!activeTransportIds.has(id)) this.retreatingTransports.delete(id);
    }
    const hostileWarships = this.game
      .units(UnitType.Warship)
      .filter(
        (warship) =>
          warship.owner() !== player && !player.isFriendly(warship.owner()),
      );
    for (const transport of transports) {
      if (
        transport.transportShipState().isRetreating ||
        this.retreatingTransports.has(transport.id())
      ) {
        continue;
      }
      const destination = transport.targetTile();
      if (destination === undefined) continue;
      const etaTicks = Math.max(
        1,
        Math.ceil(
          Math.hypot(
            this.game.x(destination) - this.game.x(transport.tile()),
            this.game.y(destination) - this.game.y(transport.tile()),
          ),
        ),
      );
      const risk = this.routeInterceptionRisk(
        transport.tile(),
        destination,
        etaTicks,
        hostileWarships,
      );
      const destinationOwner = this.game.owner(destination);
      const targetIsTribe =
        destinationOwner.isPlayer() &&
        destinationOwner.type() === PlayerType.Bot;
      const targetForceRatio = destinationOwner.isPlayer()
        ? destinationOwner.troops() / Math.max(1, player.troops())
        : 1;
      const recallThreshold = transportRecallThreshold({
        targetIsTribe,
        targetForceRatio,
        learnedLossRate: this.transportLossRate(),
      });
      // Retreat guarantees a 25% loss on arrival and remains exposed on the
      // return trip. Only turn back when continuing is materially worse.
      if (risk <= recallThreshold) continue;
      this.retreatingTransports.add(transport.id());
      this.eventBus.emit(new CancelBoatIntentEvent(transport.id()));
      this.followActiveTransport(player);
      this.setDecision(
        "Recall an endangered transport",
        `Updated visible interception risk is ${Math.round(risk * 100)}%, above the target-aware ${Math.round(recallThreshold * 100)}% recall threshold. Retreat is not free: the ship travels home under fire and only 75% of its troops return, but that is now better than continuing.`,
      );
      return;
    }
  }

  private followActiveTransport(player: PlayerView | null): void {
    if (
      player === null ||
      !this.overlay.followCamera ||
      this.game.ticks() > this.followTransportUntil ||
      this.game.ticks() < this.nextTransportCameraTick
    ) {
      return;
    }
    const transports = player.units(UnitType.TransportShip);
    const transport = transports[transports.length - 1];
    if (transport === undefined) return;
    this.nextTransportCameraTick = this.game.ticks() + 10;
    this.eventBus.emit(new GoToUnitEvent(transport));
  }

  private follow(player: PlayerView, zoom: number): void {
    if (this.overlay.followCamera) {
      this.eventBus.emit(new GoToPlayerEvent(player, zoom));
    }
  }

  private setDecision(decision: string, detail: string): void {
    this.lesson++;
    this.decision = decision;
    this.detail = detail;
    const previous = this.history[0];
    if (previous?.decision !== decision) {
      this.recordActionPrediction(decision);
    }
    if (previous?.decision === decision) {
      previous.tick = this.game.ticks();
      previous.detail = detail;
      previous.count++;
    } else {
      this.history.unshift({
        tick: this.game.ticks(),
        decision,
        detail,
        count: 1,
      });
      this.history.length = Math.min(this.history.length, 8);
    }
    this.render(this.game.myPlayer());
  }
}
