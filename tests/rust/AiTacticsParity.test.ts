// @vitest-environment node
// Raw Wasm calls keep parity coverage independent of the browser AI facade.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assessAttackCapacity,
  desiredBankedTroops,
  desiredCapacityEscapeCityCount,
  desiredDefensiveCityCount,
  desiredFactoryCount,
  desiredFleetTroopBank,
  desiredWarshipCount,
  estimateLandAttackTicks,
  isStrategicallyTrapped,
  minimumDefensePostDepth,
  nationFrontPolicy,
  nationLandFrontAllowed,
  planCapacityEscapeRaid,
  shouldAcceptAlliance,
  shouldBuildCapacityCity,
  shouldRiskDenialRaid,
  shouldTradeLandForTime,
  tribeAttackCommitmentMultiplier,
} from "../../src/client/ai/StrategyMath";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports;

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
  return new Uint32Array(
    new Uint32Array(wasm.memory.buffer, pointer, length),
  );
}

function readF64Result(wasm: Wasm): Float64Array {
  const length = wasm.openfront_result_f64_len() >>> 0;
  const pointer = wasm.openfront_result_f64_ptr() >>> 0;
  return new Float64Array(
    new Float64Array(wasm.memory.buffer, pointer, length),
  );
}

describe("tactical AI TypeScript/WebAssembly parity", () => {
  it("matches attack capacity and capacity-escape planning", async () => {
    const wasm = await loadWasm();
    const attackInput = {
      maxTroops: 125_000,
      targetTroops: 72_000,
      requiredAdvantage: 1.42,
    };
    const tsAttack = assessAttackCapacity(attackInput);
    expect(
      wasm.openfront_ai_assess_attack_capacity(
        attackInput.maxTroops,
        attackInput.targetTroops,
        attackInput.requiredAdvantage,
      ),
    ).toBe(1);
    const attackValue = readF64Result(wasm);
    const attackControl = readU32Result(wasm);
    expect(attackValue).toHaveLength(1);
    expect(attackControl).toHaveLength(1);
    expect(attackValue[0]).toBeCloseTo(tsAttack.requiredTroops, 12);
    expect(attackControl[0] !== 0).toBe(tsAttack.reachable);

    const raidInput = {
      noGrowthTicks: 480,
      reserveRatio: 0.97,
      reserveFloor: 0.56,
      incomingFronts: 0,
      outgoingFronts: 0,
      requiredCapacityRatio: 1.8,
      terrainCost: 1.3,
    };
    const tsRaid = planCapacityEscapeRaid(raidInput);
    expect(
      wasm.openfront_ai_plan_capacity_escape_raid(
        raidInput.noGrowthTicks,
        raidInput.reserveRatio,
        raidInput.reserveFloor,
        raidInput.incomingFronts,
        raidInput.outgoingFronts,
        raidInput.requiredCapacityRatio,
        raidInput.terrainCost,
      ),
    ).toBe(1);
    const raidControl = readU32Result(wasm);
    const raidValue = readF64Result(wasm);
    expect(raidControl[0]).toBe(tsRaid === null ? 0 : 1);
    expect(tsRaid).not.toBeNull();
    expect(raidValue[0]).toBeCloseTo(tsRaid!.fraction, 12);
    expect(raidValue[1]).toBeCloseTo(tsRaid!.targetGainRatio, 12);
    expect(raidValue[2]).toBeCloseTo(tsRaid!.deadlineTicks, 12);

    const blockedRaid = {
      ...raidInput,
      incomingFronts: 1,
    };
    expect(planCapacityEscapeRaid(blockedRaid)).toBeNull();
    expect(
      wasm.openfront_ai_plan_capacity_escape_raid(
        blockedRaid.noGrowthTicks,
        blockedRaid.reserveRatio,
        blockedRaid.reserveFloor,
        blockedRaid.incomingFronts,
        blockedRaid.outgoingFronts,
        blockedRaid.requiredCapacityRatio,
        blockedRaid.terrainCost,
      ),
    ).toBe(1);
    expect(readU32Result(wasm)[0]).toBe(0);
  });

  it("matches capacity city and defensive infrastructure policy", async () => {
    const wasm = await loadWasm();
    const capacityInput = {
      baselineDesiredCities: 3,
      ownedCities: 4,
      noGrowthTicks: 820,
      reserveRatio: 0.91,
      incomingFronts: 0,
      maxTroops: 200_000,
      requiredTroops: 430_000,
      cityTroopIncrease: 48_000,
    };
    expect(
      wasm.openfront_ai_desired_capacity_escape_city_count(
        capacityInput.baselineDesiredCities,
        capacityInput.ownedCities,
        capacityInput.noGrowthTicks,
        capacityInput.reserveRatio,
        capacityInput.incomingFronts,
        capacityInput.maxTroops,
        capacityInput.requiredTroops,
        capacityInput.cityTroopIncrease,
      ),
    ).toBe(desiredCapacityEscapeCityCount(capacityInput));

    const defensiveInput = {
      enemyFronts: 3,
      activeWars: 1,
      incomingFronts: 2,
      ownedCities: 5,
      ownedTiles: 7_500,
      reserveRatio: 0.43,
      incomingTroopRatio: 0.9,
    };
    expect(
      wasm.openfront_ai_desired_defensive_city_count(
        defensiveInput.enemyFronts,
        defensiveInput.activeWars,
        defensiveInput.incomingFronts,
        defensiveInput.ownedCities,
        defensiveInput.ownedTiles,
        defensiveInput.reserveRatio,
        defensiveInput.incomingTroopRatio,
      ),
    ).toBe(desiredDefensiveCityCount(defensiveInput));

    const factoryInput = {
      economicStops: 8,
      ownedCities: 10,
      ownedTiles: 14_000,
      gold: 6_000_000,
      reserveRatio: 0.71,
    };
    expect(
      wasm.openfront_ai_desired_factory_count(
        factoryInput.economicStops,
        factoryInput.ownedCities,
        factoryInput.ownedTiles,
        factoryInput.gold,
        factoryInput.reserveRatio,
      ),
    ).toBe(desiredFactoryCount(factoryInput));

    const capacityBuildInput = {
      reserveRatio: 0.61,
      hasNeutralLand: true,
      trapped: false,
      railConnections: 2,
    };
    expect(
      wasm.openfront_ai_should_build_capacity_city(
        capacityBuildInput.reserveRatio,
        capacityBuildInput.hasNeutralLand ? 1 : 0,
        capacityBuildInput.trapped ? 1 : 0,
        capacityBuildInput.railConnections,
      ) !== 0,
    ).toBe(shouldBuildCapacityCity(capacityBuildInput));

    expect(wasm.openfront_ai_minimum_defense_post_depth(1, 12)).toBe(
      minimumDefensePostDepth(true, 12),
    );
  });

  it("matches alliance, front concurrency, and denial-raid safety", async () => {
    const wasm = await loadWasm();
    const allianceInput = {
      availableAllianceSlots: 2,
      activeConflict: false,
      requestorIsTribe: false,
      preservesBestExpansionRoute: true,
      closesDangerousFront: true,
      usefulRemotePartner: false,
      crowdedBorders: true,
    };
    expect(
      wasm.openfront_ai_should_accept_alliance(
        allianceInput.availableAllianceSlots,
        allianceInput.activeConflict ? 1 : 0,
        allianceInput.requestorIsTribe ? 1 : 0,
        allianceInput.preservesBestExpansionRoute ? 1 : 0,
        allianceInput.closesDangerousFront ? 1 : 0,
        allianceInput.usefulRemotePartner ? 1 : 0,
        allianceInput.crowdedBorders ? 1 : 0,
      ) !== 0,
    ).toBe(shouldAcceptAlliance(allianceInput));

    const policyInput = { nationFronts: 4, activeNationWars: 1 };
    const tsPolicy = nationFrontPolicy(policyInput);
    expect(
      wasm.openfront_ai_nation_front_policy(
        policyInput.nationFronts,
        policyInput.activeNationWars,
      ),
    ).toBe(1);
    const policyValue = readF64Result(wasm);
    const policyControl = readU32Result(wasm);
    expect(policyValue[0]).toBeCloseTo(tsPolicy.reserveFloor, 12);
    expect(policyValue[1]).toBeCloseTo(tsPolicy.advantageMultiplier, 12);
    expect(policyControl[0]).toBe(tsPolicy.maxNationOffensives);
    expect(policyControl[1]).toBe(tsPolicy.desiredAlliances);

    const activeBorderWarIDs = new Set<string>();
    const activeOffensiveIDs = new Set<string>();
    const allowedInput = {
      isNation: true,
      targetID: "enemy",
      activeBorderWarIDs,
      activeOffensiveIDs,
      maxNationOffensives: 1,
    };
    expect(
      wasm.openfront_ai_nation_land_front_allowed(
        1,
        0,
        0,
        activeBorderWarIDs.size,
        activeOffensiveIDs.size,
        allowedInput.maxNationOffensives,
      ) !== 0,
    ).toBe(nationLandFrontAllowed(allowedInput));

    const denialInput = {
      isTribe: false,
      nationBorders: 4,
      targetTroops: 68_000,
      ourTroops: 100_000,
      targetDistracted: true,
      reserveRatio: 0.92,
    };
    expect(
      wasm.openfront_ai_should_risk_denial_raid(
        denialInput.isTribe ? 1 : 0,
        denialInput.nationBorders,
        denialInput.targetTroops,
        denialInput.ourTroops,
        denialInput.targetDistracted ? 1 : 0,
        denialInput.reserveRatio,
      ) !== 0,
    ).toBe(shouldRiskDenialRaid(denialInput));

    expect(wasm.openfront_ai_is_strategically_trapped(0, 0, 2) !== 0).toBe(
      isStrategicallyTrapped({
        hasNeutralLand: false,
        hasSeaAccess: false,
        hostileBorders: 2,
      }),
    );
  });

  it("matches reserve, retreat, tribe, and fleet commitments", async () => {
    const wasm = await loadWasm();
    const bankInput = {
      maxTroops: 260_000,
      enemyTroops: 130_000,
      enemyMaxTroops: 210_000,
      enemyFronts: 3,
      reserveFloor: 0.56,
      isTribe: false,
    };
    expect(
      wasm.openfront_ai_desired_banked_troops(
        bankInput.maxTroops,
        bankInput.enemyTroops,
        bankInput.enemyMaxTroops,
        bankInput.enemyFronts,
        bankInput.reserveFloor,
        bankInput.isTribe ? 1 : 0,
      ),
    ).toBeCloseTo(desiredBankedTroops(bankInput), 12);

    const retreatInput = {
      reserveRatio: 0.44,
      incomingTroopRatio: 0.6,
      activeIncomingFronts: 2,
    };
    expect(
      wasm.openfront_ai_should_trade_land_for_time(
        retreatInput.reserveRatio,
        retreatInput.incomingTroopRatio,
        retreatInput.activeIncomingFronts,
      ) !== 0,
    ).toBe(shouldTradeLandForTime(retreatInput));

    expect(
      wasm.openfront_ai_tribe_attack_commitment_multiplier(90_000, 40_000),
    ).toBeCloseTo(tribeAttackCommitmentMultiplier(90_000, 40_000), 12);

    const fleetBankInput = {
      maxTroops: 300_000,
      nearbyHostileWarships: 4,
      ownWarships: 2,
      hasTradeTarget: true,
    };
    expect(
      wasm.openfront_ai_desired_fleet_troop_bank(
        fleetBankInput.maxTroops,
        fleetBankInput.nearbyHostileWarships,
        fleetBankInput.ownWarships,
        fleetBankInput.hasTradeTarget ? 1 : 0,
      ),
    ).toBe(desiredFleetTroopBank(fleetBankInput));

    const warshipInput = {
      nearbyHostileWarships: 2,
      nearbyHostileTransports: 7,
      vulnerableTradeShips: 15,
      navalBias: 3.2,
    };
    expect(
      wasm.openfront_ai_desired_warship_count(
        warshipInput.nearbyHostileWarships,
        warshipInput.nearbyHostileTransports,
        warshipInput.vulnerableTradeShips,
        warshipInput.navalBias,
      ),
    ).toBe(desiredWarshipCount(warshipInput));
  });

  it("matches the live land-attack tick estimator", async () => {
    const wasm = await loadWasm();
    const input = {
      attackerTroops: 180_000,
      defenderTroops: 115_000,
      fraction: 0.27,
      borderWidth: 9,
      combatCost: 1.35,
      tilesToTake: 420,
    };
    expect(
      wasm.openfront_ai_estimate_land_attack_ticks(
        input.attackerTroops,
        input.defenderTroops,
        input.fraction,
        input.borderWidth,
        input.combatCost,
        input.tilesToTake,
      ),
    ).toBe(estimateLandAttackTicks(input));
  });
});
