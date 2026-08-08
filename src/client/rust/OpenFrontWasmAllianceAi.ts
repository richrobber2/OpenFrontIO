import { assetUrl } from "../../core/AssetUrls";
import {
  ABI_VERSION,
  ERROR_MESSAGES,
  INVALID_RESULT,
  instantiateWasm,
  type OpenFrontWasmExports,
} from "./OpenFrontWasmTypes";

const MESSAGE_COOLDOWN_TICKS = 240;

type AllianceWasmExports = OpenFrontWasmExports & {
  openfront_ai_projected_troop_growth_rate(
    maxTroops: number,
    troops: number,
    multiplier: number,
  ): number;
  openfront_ai_assess_alliance_cooperation(
    requestsAnswered: number,
    ignoredRequests: number,
    sharedFrontSamples: number,
    sharedFrontResponses: number,
    unpromptedAidEvents: number,
    allianceAgeRatio: number,
  ): number;
  openfront_ai_alliance_response_window_ticks(
    quickChatCooldownTicks: number,
    allianceDurationTicks: number,
  ): number;
  openfront_ai_plan_alliance_lifecycle(
    isSameTeam: number,
    otherIsTraitor: number,
    sharesBorder: number,
    ticksUntilExpiry: number,
    betrayalPenaltyTicks: number,
    inExtensionWindow: number,
    ownReserveRatio: number,
    otherReserveRatio: number,
    troopRatio: number,
    capacityRatio: number,
    territoryRatio: number,
    allianceCount: number,
    hostileNationBorders: number,
    activeNationWars: number,
    incomingFronts: number,
    cooperationReliability: number,
    cooperationConfidence: number,
    shouldReplaceUncooperativeAlly: number,
    replacementAvailable: number,
    otherPlayersAlive: number,
    forecastChoice: number,
    forecastThreat: number,
  ): number;
  openfront_ai_choose_aid_request(
    reserveRatio: number,
    reserveFloor: number,
    incomingTroopRatio: number,
    gold: number,
    plannedBuildCost: number,
    activeNationWars: number,
    hasTrustedAlly: number,
    ticksSinceLastRequest: number,
    messageCooldownTicks: number,
  ): number;
  openfront_ai_should_donate_troops(
    reserveRatio: number,
    reserveFloor: number,
    activeNationWars: number,
    allyIncomingTroopRatio: number,
    allyReserveRatio: number,
  ): number;
  openfront_ai_should_donate_gold(
    gold: number,
    emergencyGoldFloor: number,
    allyIncomingTroopRatio: number,
    allyReserveRatio: number,
  ): number;
  openfront_ai_should_coordinate_attack(
    ownReserveRatio: number,
    allyReserveRatio: number,
    sharedEnemy: number,
    enemyActiveWars: number,
    ownActiveNationWars: number,
    ticksSinceLastMessage: number,
    messageCooldownTicks: number,
  ): number;
  openfront_ai_plan_communication(
    aidReserveRatio: number,
    aidReserveFloor: number,
    aidIncomingTroopRatio: number,
    aidGold: number,
    aidPlannedBuildCost: number,
    aidActiveNationWars: number,
    aidHasTrustedAlly: number,
    aidTicksSinceLastRequest: number,
    donationReserveRatio: number,
    donationReserveFloor: number,
    donationGold: number,
    donationEmergencyGoldFloor: number,
    donationActiveNationWars: number,
    allyIncomingTroopRatio: number,
    allyReserveRatio: number,
    coordinationOwnReserveRatio: number,
    coordinationAllyReserveRatio: number,
    coordinationSharedEnemy: number,
    coordinationEnemyActiveWars: number,
    coordinationOwnActiveNationWars: number,
    coordinationTicksSinceLastMessage: number,
    ownTroops: number,
    ownMaxTroops: number,
    ownGold: number,
    hasSharedEnemyId: number,
    receivedMeaningfulAid: number,
    ticksSinceLastThanks: number,
    messageCooldownTicks: number,
  ): number;
  openfront_ai_plan_coalition_growth_support(
    ownTroops: number,
    ownMaxTroops: number,
    reserveFloor: number,
    activeNationWars: number,
    incomingFronts: number,
    allyTroops: number,
    allyMaxTroops: number,
    allyReliability: number,
    allyIsNation: number,
    canDonate: number,
    allyHasGrowthRoute: number,
    allyCommittedTroops: number,
    sharedEnemyTroops: number,
    sharedEnemyMaxTroops: number,
    sharedEnemyIsNation: number,
    allyCanPressureSharedEnemy: number,
    ownGrowthMultiplier: number,
    enemyGrowthMultiplier: number,
  ): number;
};

export interface RustAllianceCooperationInput {
  requestsAnswered: number;
  ignoredRequests: number;
  sharedFrontSamples: number;
  sharedFrontResponses: number;
  unpromptedAidEvents: number;
  allianceAgeRatio: number;
}

export interface RustAllianceCooperationResult {
  reliability: number;
  confidence: number;
  trusted: boolean;
  shouldReplace: boolean;
  reason: string;
}

export interface RustAllianceLifecycleInput {
  isSameTeam: boolean;
  otherIsTraitor: boolean;
  sharesBorder: boolean;
  ticksUntilExpiry: number;
  betrayalPenaltyTicks: number;
  inExtensionWindow: boolean;
  ownReserveRatio: number;
  otherReserveRatio: number;
  troopRatio: number;
  capacityRatio: number;
  territoryRatio: number;
  allianceCount: number;
  hostileNationBorders: number;
  activeNationWars: number;
  incomingFronts: number;
  cooperationReliability?: number;
  cooperationConfidence?: number;
  shouldReplaceUncooperativeAlly?: boolean;
  replacementAvailable?: boolean;
  otherPlayersAlive?: number;
  forecast?: {
    predictedChoice: string;
    threat: number;
    confidence: number;
  };
}

export interface RustAllianceLifecycleResult {
  action: "keep" | "renew" | "do-not-renew" | "break";
  reason: string;
  safeElimination: boolean;
}

export interface RustAidRequestInput {
  reserveRatio: number;
  reserveFloor: number;
  incomingTroopRatio: number;
  gold: number;
  plannedBuildCost: number | null;
  activeNationWars: number;
  hasTrustedAlly: boolean;
  ticksSinceLastRequest: number;
}

export interface RustDonationInput {
  reserveRatio: number;
  reserveFloor: number;
  gold: number;
  emergencyGoldFloor: number;
  activeNationWars: number;
  allyIncomingTroopRatio: number;
  allyReserveRatio: number;
}

export interface RustCoordinationInput {
  ownReserveRatio: number;
  allyReserveRatio: number;
  sharedEnemy: boolean;
  enemyActiveWars: number;
  ownActiveNationWars: number;
  ticksSinceLastMessage: number;
}

export interface RustCommunicationInput {
  aidRequest: RustAidRequestInput;
  donation: RustDonationInput;
  coordination: RustCoordinationInput;
  ownTroops: number;
  ownMaxTroops: number;
  ownGold: number;
  allyPlayerID?: string;
  sharedEnemyPlayerID?: string;
  receivedMeaningfulAid: boolean;
  ticksSinceLastThanks: number;
}

export type RustCommunicationResult =
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

export interface RustCoalitionGrowthSupportInput {
  ownTroops: number;
  ownMaxTroops: number;
  reserveFloor: number;
  activeNationWars: number;
  incomingFronts: number;
  allyTroops: number;
  allyMaxTroops: number;
  allyReliability: number;
  allyIsNation: boolean;
  canDonate: boolean;
  allyHasGrowthRoute: boolean;
  troopGrowthAt: (troops: number) => number;
  allyCommittedTroops?: number;
  sharedEnemyTroops?: number;
  sharedEnemyMaxTroops?: number;
  sharedEnemyIsNation?: boolean;
  allyCanPressureSharedEnemy?: boolean;
  enemyGrowthAt?: (troops: number) => number;
}

export interface RustCoalitionGrowthSupportResult {
  donate: boolean;
  amount: number;
  purpose: "none" | "growth" | "pressure";
  ownReserveAfter: number;
  growthRateBefore: number;
  growthRateAfter: number;
  growthRateGainRatio: number;
  enemyGrowthRateBefore: number;
  enemyGrowthRateAfter: number;
  enemyGrowthSuppressionRatio: number;
  projectedEnemyReserveAfter: number;
  reason: string;
}

class OpenFrontWasmAllianceAi {
  private constructor(private readonly wasm: AllianceWasmExports) {
    if ((this.wasm.openfront_abi_version() >>> 0) !== ABI_VERSION) {
      throw new Error("OpenFront alliance AI Wasm ABI mismatch");
    }
    if ((this.wasm.openfront_invalid_result() >>> 0) !== INVALID_RESULT) {
      throw new Error("OpenFront alliance AI Wasm invalid-result sentinel mismatch");
    }
    const required = [
      "openfront_ai_projected_troop_growth_rate",
      "openfront_ai_assess_alliance_cooperation",
      "openfront_ai_alliance_response_window_ticks",
      "openfront_ai_plan_alliance_lifecycle",
      "openfront_ai_choose_aid_request",
      "openfront_ai_should_donate_troops",
      "openfront_ai_should_donate_gold",
      "openfront_ai_should_coordinate_attack",
      "openfront_ai_plan_communication",
      "openfront_ai_plan_coalition_growth_support",
    ] as const;
    for (const name of required) {
      if (typeof this.wasm[name] !== "function") {
        throw new Error(`OpenFront Wasm is missing alliance AI export ${name}`);
      }
    }
  }

  static async load(): Promise<OpenFrontWasmAllianceAi> {
    const response = await fetch(assetUrl("wasm/openfront_wasm.wasm"));
    if (!response.ok) {
      throw new Error(`Unable to load OpenFront alliance AI Wasm: HTTP ${response.status}`);
    }
    const source = await instantiateWasm(response);
    return new OpenFrontWasmAllianceAi(
      source.instance.exports as AllianceWasmExports,
    );
  }

  assessCooperation(
    input: RustAllianceCooperationInput,
  ): RustAllianceCooperationResult {
    if (
      this.wasm.openfront_ai_assess_alliance_cooperation(
        input.requestsAnswered >>> 0,
        input.ignoredRequests >>> 0,
        input.sharedFrontSamples >>> 0,
        input.sharedFrontResponses >>> 0,
        input.unpromptedAidEvents >>> 0,
        input.allianceAgeRatio,
      ) === 0
    ) {
      this.throwLastError("assess alliance cooperation");
    }
    const control = this.readU32Result(3, "read alliance cooperation");
    const values = this.readF64Result(2, "read alliance cooperation scores");
    return {
      reliability: values[0]!,
      confidence: values[1]!,
      trusted: control[0] !== 0,
      shouldReplace: control[1] !== 0,
      reason:
        control[2] === 0
          ? "repeated requests were ignored and shared-front pressure stayed low"
          : control[2] === 1
            ? "the ally responds or applies useful pressure on shared fronts"
            : "the alliance still needs more cooperation evidence",
    };
  }

  responseWindowTicks(
    quickChatCooldownTicks: number,
    allianceDurationTicks: number,
  ): number {
    return this.wasm.openfront_ai_alliance_response_window_ticks(
      quickChatCooldownTicks,
      allianceDurationTicks,
    );
  }

  planLifecycle(
    input: RustAllianceLifecycleInput,
  ): RustAllianceLifecycleResult {
    if (
      this.wasm.openfront_ai_plan_alliance_lifecycle(
        input.isSameTeam ? 1 : 0,
        input.otherIsTraitor ? 1 : 0,
        input.sharesBorder ? 1 : 0,
        input.ticksUntilExpiry,
        input.betrayalPenaltyTicks,
        input.inExtensionWindow ? 1 : 0,
        input.ownReserveRatio,
        input.otherReserveRatio,
        input.troopRatio,
        input.capacityRatio,
        input.territoryRatio,
        input.allianceCount >>> 0,
        input.hostileNationBorders >>> 0,
        input.activeNationWars >>> 0,
        input.incomingFronts >>> 0,
        input.cooperationReliability ?? 0.5,
        input.cooperationConfidence ?? 0,
        input.shouldReplaceUncooperativeAlly ? 1 : 0,
        input.replacementAvailable ? 1 : 0,
        input.otherPlayersAlive ?? Number.POSITIVE_INFINITY,
        encodeForecastChoice(input.forecast?.predictedChoice),
        input.forecast?.threat ?? 0,
      ) === 0
    ) {
      this.throwLastError("plan alliance lifecycle");
    }
    const control = this.readU32Result(3, "read alliance lifecycle");
    const actions = ["keep", "renew", "do-not-renew", "break"] as const;
    return {
      action: actions[control[0]!] ?? "keep",
      reason: allianceLifecycleReason(control[1]!),
      safeElimination: control[2] !== 0,
    };
  }

  chooseAidRequest(input: RustAidRequestInput): "gold" | "troops" | "defense" | null {
    const result =
      this.wasm.openfront_ai_choose_aid_request(
        input.reserveRatio,
        input.reserveFloor,
        input.incomingTroopRatio,
        input.gold,
        input.plannedBuildCost ?? Number.NaN,
        input.activeNationWars >>> 0,
        input.hasTrustedAlly ? 1 : 0,
        input.ticksSinceLastRequest,
        MESSAGE_COOLDOWN_TICKS,
      ) >>> 0;
    return result === 1 ? "gold" : result === 2 ? "troops" : result === 3 ? "defense" : null;
  }

  shouldDonateTroops(input: RustDonationInput): boolean {
    return (
      this.wasm.openfront_ai_should_donate_troops(
        input.reserveRatio,
        input.reserveFloor,
        input.activeNationWars >>> 0,
        input.allyIncomingTroopRatio,
        input.allyReserveRatio,
      ) !== 0
    );
  }

  shouldDonateGold(input: RustDonationInput): boolean {
    return (
      this.wasm.openfront_ai_should_donate_gold(
        input.gold,
        input.emergencyGoldFloor,
        input.allyIncomingTroopRatio,
        input.allyReserveRatio,
      ) !== 0
    );
  }

  shouldCoordinateAttack(input: RustCoordinationInput): boolean {
    return (
      this.wasm.openfront_ai_should_coordinate_attack(
        input.ownReserveRatio,
        input.allyReserveRatio,
        input.sharedEnemy ? 1 : 0,
        input.enemyActiveWars >>> 0,
        input.ownActiveNationWars >>> 0,
        input.ticksSinceLastMessage,
        MESSAGE_COOLDOWN_TICKS,
      ) !== 0
    );
  }

  planCommunication(input: RustCommunicationInput): RustCommunicationResult {
    if (
      this.wasm.openfront_ai_plan_communication(
        input.aidRequest.reserveRatio,
        input.aidRequest.reserveFloor,
        input.aidRequest.incomingTroopRatio,
        input.aidRequest.gold,
        input.aidRequest.plannedBuildCost ?? Number.NaN,
        input.aidRequest.activeNationWars >>> 0,
        input.aidRequest.hasTrustedAlly ? 1 : 0,
        input.aidRequest.ticksSinceLastRequest,
        input.donation.reserveRatio,
        input.donation.reserveFloor,
        input.donation.gold,
        input.donation.emergencyGoldFloor,
        input.donation.activeNationWars >>> 0,
        input.donation.allyIncomingTroopRatio,
        input.donation.allyReserveRatio,
        input.coordination.ownReserveRatio,
        input.coordination.allyReserveRatio,
        input.coordination.sharedEnemy ? 1 : 0,
        input.coordination.enemyActiveWars >>> 0,
        input.coordination.ownActiveNationWars >>> 0,
        input.coordination.ticksSinceLastMessage,
        input.ownTroops,
        input.ownMaxTroops,
        input.ownGold,
        input.sharedEnemyPlayerID === undefined ? 0 : 1,
        input.receivedMeaningfulAid ? 1 : 0,
        input.ticksSinceLastThanks,
        MESSAGE_COOLDOWN_TICKS,
      ) === 0
    ) {
      this.throwLastError("plan alliance communication");
    }
    const control = this.readU32Result(1, "read alliance communication");
    const values = this.readF64Result(1, "read alliance communication amount");
    switch (control[0]) {
      case 1:
        return { kind: "quick-chat", key: "help.gold", targetPlayerID: input.allyPlayerID };
      case 2:
        return { kind: "quick-chat", key: "help.troops", targetPlayerID: input.allyPlayerID };
      case 3:
        return {
          kind: "quick-chat",
          key: "help.help_defend",
          targetPlayerID: input.sharedEnemyPlayerID,
        };
      case 4:
        return {
          kind: "quick-chat",
          key: "attack.focus",
          targetPlayerID: input.sharedEnemyPlayerID,
        };
      case 5:
        return { kind: "donate-troops", amount: values[0]! };
      case 6:
        return { kind: "donate-gold", amount: values[0]! };
      case 7:
        return { kind: "quick-chat", key: "greet.thanks", targetPlayerID: input.allyPlayerID };
      default:
        return { kind: "none" };
    }
  }

  planCoalitionGrowthSupport(
    input: RustCoalitionGrowthSupportInput,
  ): RustCoalitionGrowthSupportResult | null {
    const ownGrowthMultiplier = this.inferGrowthMultiplier(
      input.ownMaxTroops,
      input.troopGrowthAt,
    );
    if (ownGrowthMultiplier === null) return null;

    let enemyGrowthMultiplier = Number.NaN;
    if (input.enemyGrowthAt !== undefined) {
      enemyGrowthMultiplier =
        this.inferGrowthMultiplier(
          input.sharedEnemyMaxTroops ?? 1,
          input.enemyGrowthAt,
        ) ?? Number.NaN;
      if (Number.isNaN(enemyGrowthMultiplier)) return null;
    }

    if (
      this.wasm.openfront_ai_plan_coalition_growth_support(
        input.ownTroops,
        input.ownMaxTroops,
        input.reserveFloor,
        input.activeNationWars >>> 0,
        input.incomingFronts >>> 0,
        input.allyTroops,
        input.allyMaxTroops,
        input.allyReliability,
        input.allyIsNation ? 1 : 0,
        input.canDonate ? 1 : 0,
        input.allyHasGrowthRoute ? 1 : 0,
        input.allyCommittedTroops ?? 0,
        input.sharedEnemyTroops ?? 0,
        input.sharedEnemyMaxTroops ?? 0,
        input.sharedEnemyIsNation ? 1 : 0,
        input.allyCanPressureSharedEnemy ? 1 : 0,
        ownGrowthMultiplier,
        enemyGrowthMultiplier,
      ) === 0
    ) {
      this.throwLastError("plan coalition growth support");
    }

    const control = this.readU32Result(3, "read coalition growth support");
    const values = this.readF64Result(9, "read coalition growth support values");
    const purposes = ["none", "growth", "pressure"] as const;
    return {
      donate: control[0] !== 0,
      amount: values[0]!,
      purpose: purposes[control[1]!] ?? "none",
      ownReserveAfter: values[1]!,
      growthRateBefore: values[2]!,
      growthRateAfter: values[3]!,
      growthRateGainRatio: values[4]!,
      enemyGrowthRateBefore: values[5]!,
      enemyGrowthRateAfter: values[6]!,
      enemyGrowthSuppressionRatio: values[7]!,
      projectedEnemyReserveAfter: values[8]!,
      reason: coalitionSupportReason(control[2]!),
    };
  }

  private inferGrowthMultiplier(
    maxTroops: number,
    growthAt: (troops: number) => number,
  ): number | null {
    const safeMax = Math.max(1, maxTroops);
    const firstTroops = safeMax * 0.37;
    const secondTroops = safeMax * 0.61;
    const firstBase = this.wasm.openfront_ai_projected_troop_growth_rate(
      safeMax,
      firstTroops,
      1,
    );
    const firstActual = growthAt(firstTroops);
    if (!(firstBase > 0) || !Number.isFinite(firstActual) || firstActual < 0) {
      return null;
    }
    const multiplier = firstActual / firstBase;
    if (!Number.isFinite(multiplier) || multiplier < 0) return null;

    const secondExpected = this.wasm.openfront_ai_projected_troop_growth_rate(
      safeMax,
      secondTroops,
      multiplier,
    );
    const secondActual = growthAt(secondTroops);
    const tolerance = Math.max(1e-7, Math.abs(secondActual) * 1e-8);
    return Number.isFinite(secondActual) &&
      Math.abs(secondExpected - secondActual) <= tolerance
      ? multiplier
      : null;
  }

  private readU32Result(expected: number, operation: string): Uint32Array {
    const length = this.wasm.openfront_result_len() >>> 0;
    if (length !== expected) {
      throw new Error(`${operation}: expected ${expected} words, got ${length}`);
    }
    const pointer = this.wasm.openfront_result_ptr() >>> 0;
    return new Uint32Array(new Uint32Array(this.wasm.memory.buffer, pointer, length));
  }

  private readF64Result(expected: number, operation: string): Float64Array {
    const length = this.wasm.openfront_result_f64_len() >>> 0;
    if (length !== expected) {
      throw new Error(`${operation}: expected ${expected} lanes, got ${length}`);
    }
    const pointer = this.wasm.openfront_result_f64_ptr() >>> 0;
    return new Float64Array(new Float64Array(this.wasm.memory.buffer, pointer, length));
  }

  private throwLastError(operation: string): never {
    const code = this.wasm.openfront_last_error() >>> 0;
    const message = ERROR_MESSAGES[code] ?? `unknown Rust error ${code}`;
    throw new Error(`Unable to ${operation}: ${message}`);
  }
}

function encodeForecastChoice(choice: string | undefined): number {
  switch (choice) {
    case "expand":
      return 1;
    case "economy":
      return 2;
    case "attack":
      return 3;
    case "defend":
      return 4;
    default:
      return 0;
  }
}

function allianceLifecycleReason(code: number): string {
  switch (code) {
    case 0:
      return "team membership is permanent strategic cooperation";
    case 1:
      return "the ally is already a traitor and is a safely finishable bordering remnant";
    case 2:
      return "this ally is the only remaining opponent and our full reserve has the stronger forecast; keeping the pact would make victory impossible";
    case 3:
      return "this ally is the only remaining opponent, so another extension would indefinitely postpone the final contest";
    case 4:
      return "repeated coordination requests were ignored while a viable replacement partner is available";
    case 5:
      return "the ally has not reciprocated requests or shared-front pressure enough to justify another alliance term";
    case 6:
      return "waiting for expiry would preserve a harmless remnant for too long, while no other hostile front can punish the traitor window";
    case 7:
      return "the weak bordering ally blocks a low-risk expansion route; clean expiry avoids the traitor penalty";
    case 8:
      return "the ally's projected growth would turn it into a dangerous permanent neighbor after renewal";
    case 9:
      return "the alliance still closes a meaningful front or preserves a comparable partner";
    case 10:
      return "the alliance no longer offsets an alliance slot or blocked expansion route";
    default:
      return "the alliance is useful now and does not need an extension yet";
  }
}

function coalitionSupportReason(code: number): string {
  switch (code) {
    case 0:
      return "the recipient is not a legal allied nation donation target";
    case 1:
      return "an active home front requires keeping the surplus available";
    case 2:
      return "the donor lacks an overfull reserve or the ally lacks useful troop headroom";
    case 3:
      return "the ally cannot turn a troop donation into territorial growth or useful shared pressure";
    case 4:
      return "the ally is not reliable enough for growth investment";
    case 5:
      return "the ally lacks useful troop headroom for growth";
    case 6:
      return "the safe growth surplus is too small to change the front";
    case 7:
      return "the proposed donation would not improve the donor's regeneration rate";
    case 8:
      return "a reliable nation has a legal growth route while the donation increases home regeneration";
    default:
      return "the ally is already pinning a shared nation and added troops reduce its projected regeneration";
  }
}

let rustAllianceAi: OpenFrontWasmAllianceAi | null = null;
let rustAllianceAiLoad: Promise<void> | null = null;
let rustAllianceAiDisabled = false;
let rustAllianceAiFailureLogged = false;

export function preloadRustAllianceAi(): Promise<void> {
  if (rustAllianceAi !== null || rustAllianceAiDisabled) return Promise.resolve();
  if (rustAllianceAiLoad !== null) return rustAllianceAiLoad;
  rustAllianceAiLoad = OpenFrontWasmAllianceAi.load()
    .then((ai) => {
      rustAllianceAi = ai;
    })
    .catch((error: unknown) => {
      rustAllianceAiDisabled = true;
      logRustAllianceAiFailure(error);
    });
  return rustAllianceAiLoad;
}

function withAllianceAi<T>(operation: (ai: OpenFrontWasmAllianceAi) => T): T | null {
  if (rustAllianceAi === null || rustAllianceAiDisabled) return null;
  try {
    return operation(rustAllianceAi);
  } catch (error) {
    rustAllianceAi = null;
    rustAllianceAiDisabled = true;
    logRustAllianceAiFailure(error);
    return null;
  }
}

export const assessAllianceCooperationRust = (
  input: RustAllianceCooperationInput,
): RustAllianceCooperationResult | null =>
  withAllianceAi((ai) => ai.assessCooperation(input));

export const allianceResponseWindowTicksRust = (
  quickChatCooldownTicks: number,
  allianceDurationTicks: number,
): number | null =>
  withAllianceAi((ai) =>
    ai.responseWindowTicks(quickChatCooldownTicks, allianceDurationTicks),
  );

export const planAllianceLifecycleRust = (
  input: RustAllianceLifecycleInput,
): RustAllianceLifecycleResult | null =>
  withAllianceAi((ai) => ai.planLifecycle(input));

export const chooseAidRequestRust = (
  input: RustAidRequestInput,
): "gold" | "troops" | "defense" | null | undefined => {
  const result = withAllianceAi((ai) => ai.chooseAidRequest(input));
  return result === null && rustAllianceAi === null ? undefined : result;
};

export const shouldDonateTroopsRust = (
  input: RustDonationInput,
): boolean | null => withAllianceAi((ai) => ai.shouldDonateTroops(input));

export const shouldDonateGoldRust = (
  input: RustDonationInput,
): boolean | null => withAllianceAi((ai) => ai.shouldDonateGold(input));

export const shouldCoordinateAttackRust = (
  input: RustCoordinationInput,
): boolean | null => withAllianceAi((ai) => ai.shouldCoordinateAttack(input));

export const planCommunicationRust = (
  input: RustCommunicationInput,
): RustCommunicationResult | null =>
  withAllianceAi((ai) => ai.planCommunication(input));

export const planCoalitionGrowthSupportRust = (
  input: RustCoalitionGrowthSupportInput,
): RustCoalitionGrowthSupportResult | null =>
  withAllianceAi((ai) => ai.planCoalitionGrowthSupport(input));

function logRustAllianceAiFailure(error: unknown): void {
  if (rustAllianceAiFailureLogged) return;
  rustAllianceAiFailureLogged = true;
  console.warn("Rust alliance AI disabled; using TypeScript fallback", error);
}
