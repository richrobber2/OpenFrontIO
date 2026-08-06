import { performance } from "node:perf_hooks";
import {
  earlyPortSeizureValue,
  isNavalRemnantOpportunity,
  maximumNavalInterceptionRisk,
  minimumNavalLaunchReserveRatio,
  navalLaunchDelayTicks,
  overseasExpansionValue,
  preferTribeExpansionTargets,
  prioritizePortLandingTiles,
  relativeOverseasLaunchTroops,
  transportRecallThreshold,
} from "../../src/client/ai/OverseasExpansionPolicy";

const TARGETS = 10_000;
const RUNS = 7;
const samples: number[] = [];
let checksum = 0;
for (let run = 0; run < RUNS; run++) {
  const start = performance.now();
  for (let target = 0; target < TARGETS; target++) {
    checksum += overseasExpansionValue({
      landTiles: 50 + ((target * 97) % 10_000),
      ports: target % 5,
      troopDensity: 10 + ((target * 31) % 2_000),
      normalizedDistance: (target % 100) / 100,
      isTribe: target % 3 !== 0,
      opensNationWar: target % 3 === 0,
    });
    checksum += navalLaunchDelayTicks({
      maximumTransports: 12,
      activeTransports: target % 12,
      transportLossRate: (target % 10) / 10,
      earlyExpansion: target < 2_500,
      isTribe: target % 3 !== 0,
    });
    checksum += minimumNavalLaunchReserveRatio(target, 0.8);
    checksum += maximumNavalInterceptionRisk({
      transportLossRate: (target % 10) / 10,
      navalGene: (target % 5) / 10,
      cautionGene: (target % 3) / 10,
      noLandFront: target % 2 === 0,
      reserveRatio: 0.5 + (target % 50) / 100,
    });
    checksum += relativeOverseasLaunchTroops({
      enemyTroops: 1_000 + target,
      requiredLandingAdvantage: 1.05 + (target % 4) * 0.1,
      minimumLaunchTroops: 8_000,
      maximumLaunchTroops: 100_000,
    });
    checksum += earlyPortSeizureValue({
      ticks: target,
      enemyPorts: target % 4,
      enemyWarships: target % 5 === 0 ? 1 : 0,
      enemyToOwnTroopRatio: (target % 30) / 100,
    });
    checksum += isNavalRemnantOpportunity({
      ownTroops: 1_000_000,
      ownTiles: 100_000,
      targetTroops: target * 10,
      targetTiles: target,
      targetIsAllied: false,
    })
      ? 1
      : 0;
    checksum += transportRecallThreshold({
      targetIsTribe: target % 2 === 0,
      targetForceRatio: (target % 100) / 100,
      learnedLossRate: (target % 10) / 10,
    });
  }
  checksum += preferTribeExpansionTargets([
    { isTribe: false },
    { isTribe: true },
  ]).length;
  checksum += prioritizePortLandingTiles([1, 2, 3, 4, 5, 6], [5, 6], 4).length;
  samples.push(performance.now() - start);
}
if (checksum === 0) throw new Error("overseas benchmark was optimized away");
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(samples.length / 2)];
console.log("Overseas expansion planning benchmark");
console.log(`workload: ${TARGETS.toLocaleString()} targets`);
console.log(
  `p50: ${p50.toFixed(2)}ms (${(p50 / TARGETS).toFixed(6)}ms/target)`,
);
if (p50 > 15) process.exitCode = 1;
