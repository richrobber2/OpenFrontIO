// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allianceResponseWindowTicks,
  assessAllianceCooperation,
} from "../../src/client/ai/AllianceCooperationPolicy";
import { planAllianceLifecycle } from "../../src/client/ai/AllianceLifecyclePolicy";
import { planCoalitionGrowthSupport } from "../../src/client/ai/CoalitionPlanningPolicy";
import { planCommunication } from "../../src/client/ai/CommunicationPlanner";
import {
  chooseAidRequest,
  shouldCoordinateAttack,
  shouldDonateGold,
  shouldDonateTroops,
} from "../../src/client/ai/DiplomacyPolicy";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports & {
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
  openfront_ai_plan_alliance_lifecycle(...args: number[]): number;
  openfront_ai_choose_aid_request(...args: number[]): number;
  openfront_ai_should_donate_troops(...args: number[]): number;
  openfront_ai_should_donate_gold(...args: number[]): number;
  openfront_ai_should_coordinate_attack(...args: number[]): number;
  openfront_ai_plan_communication(...args: number[]): number;
  openfront_ai_plan_coalition_growth_support(...args: number[]): number;
};

async function loadWasm(): Promise<Wasm> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  const source = await WebAssembly.instantiate(
    new Uint8Array(await readFile(wasmPath)),
    {},
  );
  return source.instance.exports as Wasm;
}

function readU32Result(wasm: Wasm): Uint32Array {
  const length = wasm.openfront_result_len() >>> 0;
  const pointer = wasm.openfront_result_ptr() >>> 0;
  return new Uint32Array(new Uint32Array(wasm.memory.buffer, pointer, length));
}

function readF64Result(wasm: Wasm): Float64Array {
  const length = wasm.openfront_result_f64_len() >>> 0;
  const pointer = wasm.openfront_result_f64_ptr() >>> 0;
  return new Float64Array(new Float64Array(wasm.memory.buffer, pointer, length));
}

function growthRate(maxTroops: number, troops: number, multiplier = 1): number {
  const max = Math.max(1, maxTroops);
  const projectedTroops = Math.max(0, Math.min(max, troops));
  let toAdd = 10 + Math.pow(projectedTroops, 0.73) / 4;
  toAdd *= 1 - projectedTroops / max;
  toAdd *= Math.max(0, multiplier);
  return Math.min(projectedTroops + toAdd, max) - projectedTroops;
}

function lifecycleChoice(choice: string | undefined): number {
  return choice === "expand"
    ? 1
    : choice === "economy"
      ? 2
      : choice === "attack"
        ? 3
        : choice === "defend"
          ? 4
          : 0;
}

describe("alliance AI TypeScript/WebAssembly parity", () => {
  it("scores cooperation and response windows identically", async () => {
    const wasm = await loadWasm();
    const input = {
      requestsAnswered: 3,
      ignoredRequests: 1,
      sharedFrontSamples: 8,
      sharedFrontResponses: 6,
      unpromptedAidEvents: 1,
      allianceAgeRatio: 0.55,
    };
    const ts = assessAllianceCooperation(input);
    expect(
      wasm.openfront_ai_assess_alliance_cooperation(
        input.requestsAnswered,
        input.ignoredRequests,
        input.sharedFrontSamples,
        input.sharedFrontResponses,
        input.unpromptedAidEvents,
        input.allianceAgeRatio,
      ),
    ).toBe(1);
    const control = readU32Result(wasm);
    const values = readF64Result(wasm);
    expect(values[0]).toBeCloseTo(ts.reliability, 12);
    expect(values[1]).toBeCloseTo(ts.confidence, 12);
    expect(control[0] !== 0).toBe(ts.trusted);
    expect(control[1] !== 0).toBe(ts.shouldReplace);

    const windowInput = {
      quickChatCooldownTicks: 240,
      allianceDurationTicks: 9_000,
    };
    expect(
      wasm.openfront_ai_alliance_response_window_ticks(
        windowInput.quickChatCooldownTicks,
        windowInput.allianceDurationTicks,
      ),
    ).toBe(allianceResponseWindowTicks(windowInput));
  });

  it("makes the same alliance lifecycle decision", async () => {
    const wasm = await loadWasm();
    const input = {
      isSameTeam: false,
      otherIsTraitor: false,
      sharesBorder: true,
      ticksUntilExpiry: 140,
      betrayalPenaltyTicks: 300,
      inExtensionWindow: true,
      ownReserveRatio: 0.86,
      otherReserveRatio: 0.42,
      troopRatio: 0.36,
      capacityRatio: 0.44,
      territoryRatio: 0.4,
      allianceCount: 2,
      hostileNationBorders: 0,
      activeNationWars: 0,
      incomingFronts: 0,
      cooperationReliability: 0.25,
      cooperationConfidence: 0.8,
      shouldReplaceUncooperativeAlly: true,
      replacementAvailable: true,
      otherPlayersAlive: 4,
      forecast: {
        predictedChoice: "expand" as const,
        threat: 0.5,
        confidence: 0.8,
      },
    };
    const ts = planAllianceLifecycle(input);
    expect(
      wasm.openfront_ai_plan_alliance_lifecycle(
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
        input.allianceCount,
        input.hostileNationBorders,
        input.activeNationWars,
        input.incomingFronts,
        input.cooperationReliability,
        input.cooperationConfidence,
        input.shouldReplaceUncooperativeAlly ? 1 : 0,
        input.replacementAvailable ? 1 : 0,
        input.otherPlayersAlive,
        lifecycleChoice(input.forecast.predictedChoice),
        input.forecast.threat,
      ),
    ).toBe(1);
    const control = readU32Result(wasm);
    const actions = ["keep", "renew", "do-not-renew", "break"] as const;
    expect(actions[control[0]!]).toBe(ts.action);
    expect(control[2] !== 0).toBe(ts.safeElimination);
  });

  it("keeps aid, donation, coordination, and communication priorities identical", async () => {
    const wasm = await loadWasm();
    const aid = {
      reserveRatio: 0.34,
      reserveFloor: 0.48,
      incomingTroopRatio: 0.1,
      gold: 500_000,
      plannedBuildCost: null,
      activeNationWars: 0,
      hasTrustedAlly: true,
      ticksSinceLastRequest: 500,
    };
    const donation = {
      reserveRatio: 0.9,
      reserveFloor: 0.48,
      gold: 2_000_000,
      emergencyGoldFloor: 500_000,
      activeNationWars: 0,
      allyIncomingTroopRatio: 0.5,
      allyReserveRatio: 0.4,
    };
    const coordination = {
      ownReserveRatio: 0.8,
      allyReserveRatio: 0.4,
      sharedEnemy: true,
      enemyActiveWars: 1,
      ownActiveNationWars: 0,
      ticksSinceLastMessage: 500,
    };

    const aidCodes: Record<string, number> = { gold: 1, troops: 2, defense: 3 };
    const tsAid = chooseAidRequest(aid);
    expect(
      wasm.openfront_ai_choose_aid_request(
        aid.reserveRatio,
        aid.reserveFloor,
        aid.incomingTroopRatio,
        aid.gold,
        Number.NaN,
        aid.activeNationWars,
        aid.hasTrustedAlly ? 1 : 0,
        aid.ticksSinceLastRequest,
        240,
      ),
    ).toBe(tsAid === null ? 0 : aidCodes[tsAid]);
    expect(
      wasm.openfront_ai_should_donate_troops(
        donation.reserveRatio,
        donation.reserveFloor,
        donation.activeNationWars,
        donation.allyIncomingTroopRatio,
        donation.allyReserveRatio,
      ) !== 0,
    ).toBe(shouldDonateTroops(donation));
    expect(
      wasm.openfront_ai_should_donate_gold(
        donation.gold,
        donation.emergencyGoldFloor,
        donation.allyIncomingTroopRatio,
        donation.allyReserveRatio,
      ) !== 0,
    ).toBe(shouldDonateGold(donation));
    expect(
      wasm.openfront_ai_should_coordinate_attack(
        coordination.ownReserveRatio,
        coordination.allyReserveRatio,
        coordination.sharedEnemy ? 1 : 0,
        coordination.enemyActiveWars,
        coordination.ownActiveNationWars,
        coordination.ticksSinceLastMessage,
        240,
      ) !== 0,
    ).toBe(shouldCoordinateAttack(coordination));

    const communication = {
      aidRequest: aid,
      donation,
      coordination,
      ownTroops: 900_000,
      ownMaxTroops: 1_000_000,
      ownGold: 2_000_000,
      allyPlayerID: "ally",
      sharedEnemyPlayerID: "enemy",
      receivedMeaningfulAid: false,
      ticksSinceLastThanks: 500,
    };
    const tsCommunication = planCommunication(communication);
    expect(
      wasm.openfront_ai_plan_communication(
        aid.reserveRatio,
        aid.reserveFloor,
        aid.incomingTroopRatio,
        aid.gold,
        Number.NaN,
        aid.activeNationWars,
        aid.hasTrustedAlly ? 1 : 0,
        aid.ticksSinceLastRequest,
        donation.reserveRatio,
        donation.reserveFloor,
        donation.gold,
        donation.emergencyGoldFloor,
        donation.activeNationWars,
        donation.allyIncomingTroopRatio,
        donation.allyReserveRatio,
        coordination.ownReserveRatio,
        coordination.allyReserveRatio,
        coordination.sharedEnemy ? 1 : 0,
        coordination.enemyActiveWars,
        coordination.ownActiveNationWars,
        coordination.ticksSinceLastMessage,
        communication.ownTroops,
        communication.ownMaxTroops,
        communication.ownGold,
        1,
        0,
        communication.ticksSinceLastThanks,
        240,
      ),
    ).toBe(1);
    const commControl = readU32Result(wasm);
    const commValues = readF64Result(wasm);
    const actionCode =
      tsCommunication.kind === "none"
        ? 0
        : tsCommunication.kind === "donate-troops"
          ? 5
          : tsCommunication.kind === "donate-gold"
            ? 6
            : tsCommunication.key === "help.gold"
              ? 1
              : tsCommunication.key === "help.troops"
                ? 2
                : tsCommunication.key === "help.help_defend"
                  ? 3
                  : tsCommunication.key === "attack.focus"
                    ? 4
                    : 7;
    expect(commControl[0]).toBe(actionCode);
    if (tsCommunication.kind === "donate-troops" || tsCommunication.kind === "donate-gold") {
      expect(commValues[0]).toBe(tsCommunication.amount);
    }
  });

  it("chooses the same coalition growth and pressure donations", async () => {
    const wasm = await loadWasm();
    const scenarios = [
      {
        ownTroops: 950_000,
        ownMaxTroops: 1_000_000,
        reserveFloor: 0.48,
        activeNationWars: 0,
        incomingFronts: 0,
        allyTroops: 300_000,
        allyMaxTroops: 1_000_000,
        allyReliability: 0.9,
        allyIsNation: true,
        canDonate: true,
        allyHasGrowthRoute: true,
        troopGrowthAt: (troops: number) => growthRate(1_000_000, troops, 1),
      },
      {
        ownTroops: 980_000,
        ownMaxTroops: 1_000_000,
        reserveFloor: 0.48,
        activeNationWars: 0,
        incomingFronts: 0,
        allyTroops: 500_000,
        allyMaxTroops: 1_000_000,
        allyReliability: 0.9,
        allyIsNation: true,
        canDonate: true,
        allyHasGrowthRoute: false,
        troopGrowthAt: (troops: number) => growthRate(1_000_000, troops, 1),
        allyCommittedTroops: 600_000,
        sharedEnemyTroops: 300_000,
        sharedEnemyMaxTroops: 1_000_000,
        sharedEnemyIsNation: true,
        allyCanPressureSharedEnemy: true,
        enemyGrowthAt: (troops: number) => growthRate(1_000_000, troops, 1),
      },
    ];

    for (const input of scenarios) {
      const ts = planCoalitionGrowthSupport(input);
      expect(
        wasm.openfront_ai_plan_coalition_growth_support(
          input.ownTroops,
          input.ownMaxTroops,
          input.reserveFloor,
          input.activeNationWars,
          input.incomingFronts,
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
          1,
          input.enemyGrowthAt === undefined ? Number.NaN : 1,
        ),
      ).toBe(1);
      const control = readU32Result(wasm);
      const values = readF64Result(wasm);
      const purposes = ["none", "growth", "pressure"] as const;
      expect(control[0] !== 0).toBe(ts.donate);
      expect(purposes[control[1]!]).toBe(ts.purpose);
      expect(values[0]).toBeCloseTo(ts.amount, 12);
      expect(values[1]).toBeCloseTo(ts.ownReserveAfter, 12);
      expect(values[2]).toBeCloseTo(ts.growthRateBefore, 12);
      expect(values[3]).toBeCloseTo(ts.growthRateAfter, 12);
      expect(values[4]).toBeCloseTo(ts.growthRateGainRatio, 12);
      expect(values[5]).toBeCloseTo(ts.enemyGrowthRateBefore, 12);
      expect(values[6]).toBeCloseTo(ts.enemyGrowthRateAfter, 12);
      expect(values[7]).toBeCloseTo(ts.enemyGrowthSuppressionRatio, 12);
      expect(values[8]).toBeCloseTo(ts.projectedEnemyReserveAfter, 12);
    }
  });
});
