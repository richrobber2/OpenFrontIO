import { factoryOpportunityRetryTick } from "../../src/client/ai/DecisionTriggerPolicy";
import {
  capacityEscapeCityBudget,
  planEconomicSystems,
  selectFactoryUpgradeCandidates,
  shouldFundFirstPressureFactory,
} from "../../src/client/ai/EconomicSystemPolicy";

const decisions = 10_000;
const factories = Array.from({ length: 26 }, (_, id) => ({
  id,
  economicScore: 8 + (id % 9),
  level: 1 + (id % 4),
}));
let checksum = 0;
const started = performance.now();
for (let index = 0; index < decisions; index++) {
  const plan = planEconomicSystems({
    gold: 72_000_000 + index,
    incomePerMinute: 67_000,
    reserveRatio: 0.94,
    incomingTroopRatio: 0,
    hostileFronts: 1,
    activeNationWars: 0,
    hasNeutralLand: false,
    trapped: false,
    cities: 71,
    desiredCities: 71,
    stackedCities: 29,
    factories: 26,
    productiveFactoryStops: 272,
    isolatedFactories: 0,
    ports: 31,
    factoryConnectedPorts: 29,
    unconnectedPorts: 2,
    tradePartners: 5,
    embargoedPartners: 3,
    railStops: 102,
    connectedRailStops: 101,
    defensePosts: 80,
    strategicStructures: 173,
    exposedEconomicStructures: 42,
    cityCost: 1_000_000,
    factoryCost: 1_000_000,
    portCost: 1_000_000,
    defensePostCost: 150_000,
  });
  const upgrades = selectFactoryUpgradeCandidates(
    factories,
    (factory) => factory.economicScore * (1 + factory.level * 0.25),
    4,
  );
  const capacityBudget = capacityEscapeCityBudget({
    gold: 2_000_000,
    protectedSpendableGold: 0,
    cityCost: 1_000_000,
    cities: 12,
    desiredCities: 16,
    requiredTroops: 6_000_000,
    maxTroops: 5_000_000,
    incomingFronts: 0,
    hostileFronts: 4,
    activeNationWars: 1,
    reserveRatio: 0.82,
  });
  if (plan.action !== "protect-assets" || upgrades.length !== 4) {
    throw new Error("saturated network selected wasteful rail work");
  }
  checksum +=
    plan.scores["activate-rail"] +
    upgrades[0].id +
    factoryOpportunityRetryTick(index, "saturated");
  checksum += capacityBudget.spendableGold * 0.000_001;
  checksum += shouldFundFirstPressureFactory({
    factories: 0,
    cities: 8,
    ownedTiles: 40_000,
    reserveRatio: 0.82,
    incomingFronts: 0,
    hostileFronts: 3,
    activeNationWars: 1,
    noGrowthTicks: index % 300,
    unconnectedPorts: 1,
  })
    ? 1
    : 0;
}
const totalMs = performance.now() - started;
if (totalMs > 2_000) {
  throw new Error(`saturated economy benchmark exceeded budget: ${totalMs}ms`);
}
console.log(
  JSON.stringify({
    ok: true,
    decisions,
    totalMs: Number(totalMs.toFixed(2)),
    meanUs: Number(((totalMs * 1_000) / decisions).toFixed(3)),
    maximumFactoryQueries: 4,
    saturatedRetryTicks: factoryOpportunityRetryTick(0, "saturated"),
    checksum: Number(checksum.toFixed(2)),
  }),
);
