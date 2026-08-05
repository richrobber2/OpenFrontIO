import { describe, expect, it } from "vitest";
import {
  modelOpponent,
  planStrategicAction,
  type OpponentModel,
} from "../../src/client/ai/StrategicActionPlanner";
import {
  assessStrategicStrike,
  planStrategicCapability,
} from "../../src/client/ai/StrategicWeaponsPolicy";

type BrainScenario = {
  name: string;
  reserveRatio: number;
  incomingFronts: number;
  incomingTroops: number;
  maxTroops: number;
  hasNeutralLand: boolean;
  hostileBorders: number;
  activeNationWars: number;
  ownSilos: number;
  readySlots: number;
  affordableWeapons: number;
  enemySilos: number;
  actionableTargets: number;
  expectedAction: "defend" | "strike" | "expand" | "attack" | "infrastructure";
  expectedCanFire: boolean;
  expectedBuildSilo: boolean;
  opponents?: readonly OpponentModel[];
};

const opponent = modelOpponent({
  id: "rapid-strategic-rival",
  troops: 900_000,
  maxTroops: 1_000_000,
  tiles: 8_000,
  ownTiles: 2_000,
  incomingAttacks: 0,
  outgoingAttacks: 2,
  silos: 2,
  warships: 0,
  predictedChoice: "expand",
  forecastThreat: 2.5,
});

const scenarios: readonly BrainScenario[] = [
  {
    name: "under attack with a low reserve",
    reserveRatio: 0.28,
    incomingFronts: 2,
    incomingTroops: 400_000,
    maxTroops: 1_000_000,
    hasNeutralLand: true,
    hostileBorders: 3,
    activeNationWars: 2,
    ownSilos: 0,
    readySlots: 0,
    affordableWeapons: 0,
    enemySilos: 2,
    actionableTargets: 4,
    expectedAction: "defend",
    expectedCanFire: false,
    expectedBuildSilo: false,
  },
  {
    name: "loaded silo against a reachable strategic rival",
    reserveRatio: 0.82,
    incomingFronts: 0,
    incomingTroops: 0,
    maxTroops: 1_000_000,
    hasNeutralLand: false,
    hostileBorders: 0,
    activeNationWars: 0,
    ownSilos: 1,
    readySlots: 2,
    affordableWeapons: 1,
    enemySilos: 2,
    actionableTargets: 1,
    expectedAction: "strike",
    expectedCanFire: true,
    expectedBuildSilo: false,
    opponents: [opponent],
  },
  {
    name: "safe strategic buildup with enough gold for a first silo",
    reserveRatio: 0.78,
    incomingFronts: 0,
    incomingTroops: 0,
    maxTroops: 1_000_000,
    hasNeutralLand: false,
    hostileBorders: 1,
    activeNationWars: 0,
    ownSilos: 0,
    readySlots: 0,
    affordableWeapons: 0,
    enemySilos: 2,
    actionableTargets: 2,
    expectedAction: "attack",
    expectedCanFire: false,
    expectedBuildSilo: true,
    opponents: [opponent],
  },
  {
    name: "neutral land expansion takes priority over remote silo noise",
    reserveRatio: 0.8,
    incomingFronts: 0,
    incomingTroops: 0,
    maxTroops: 1_000_000,
    hasNeutralLand: true,
    hostileBorders: 1,
    activeNationWars: 0,
    ownSilos: 0,
    readySlots: 0,
    affordableWeapons: 0,
    enemySilos: 400,
    actionableTargets: 0,
    expectedAction: "expand",
    expectedCanFire: false,
    expectedBuildSilo: false,
  },
];

function evaluateScenario(scenario: BrainScenario) {
  const capability = planStrategicCapability({
    ownSilos: scenario.ownSilos,
    readyLaunchSlots: scenario.readySlots,
    affordableWeapons: scenario.affordableWeapons,
    actionableTargets: scenario.actionableTargets,
    enemySilos: scenario.enemySilos,
    highestThreat: scenario.opponents?.[0]?.forecastThreat ?? 0,
    reserveRatio: scenario.reserveRatio,
    incomingPressureRatio:
      scenario.incomingTroops / Math.max(1, scenario.maxTroops),
    activeNationWars: scenario.activeNationWars,
    gold: scenario.expectedBuildSilo ? 1_500_000 : 300_000,
    reserveGold: 250_000,
    siloCost: 1_000_000,
  });
  const plan = planStrategicAction({
    reserveRatio: scenario.reserveRatio,
    incomingFronts: scenario.incomingFronts,
    incomingTroops: scenario.incomingTroops,
    maxTroops: scenario.maxTroops,
    hasNeutralLand: scenario.hasNeutralLand,
    hostileBorders: scenario.hostileBorders,
    activeNationWars: scenario.activeNationWars,
    navalThreats: 0,
    tradeTargets: 0,
    siloTargets: scenario.enemySilos,
    readyStrategicSlots: scenario.readySlots,
    affordableStrategicWeapons: scenario.affordableWeapons,
    actionableStrikeTargets: scenario.actionableTargets,
    opponents: scenario.opponents ?? [],
  });
  return { capability, plan };
}

describe("AI brain scenario scorecard", () => {
  it.each(scenarios)("passes: $name", (scenario) => {
    const result = evaluateScenario(scenario);
    expect(result.plan.action).toBe(scenario.expectedAction);
    expect(result.capability.canFire).toBe(scenario.expectedCanFire);
    expect(result.capability.shouldBuildSilo).toBe(scenario.expectedBuildSilo);
  });

  it("rejects a strike when the SAM route cannot be saturated", () => {
    const decision = assessStrategicStrike({
      weapon: "nuke",
      targetTroops: 1_000_000,
      targetStructures: 8,
      targetTerritoryShare: 0.2,
      targetActiveWars: 1,
      targetHasSamCoverage: true,
      targetIsWinning: true,
      targetIsAlly: false,
      ownReserveRatio: 0.8,
      ownActiveNationWars: 0,
      availableWeapons: 2,
      ticksSinceLastStrike: 1,
      samInterceptionCapacity: 3,
      requiredSalvoSize: 4,
      weaponCost: 750_000,
      spendableGold: 2_000_000,
    });
    expect(decision.fire).toBe(false);
    expect(decision.reasons).toContain(
      "loaded silo slots cannot saturate the SAM route",
    );
  });

  it("keeps the scorecard deterministic", () => {
    const first = scenarios.map((scenario) => evaluateScenario(scenario));
    const second = scenarios.map((scenario) => evaluateScenario(scenario));
    expect(second).toEqual(first);
  });
});
