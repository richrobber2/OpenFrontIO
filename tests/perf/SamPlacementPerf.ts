import { performance } from "node:perf_hooks";
import { scoreSamPlacement } from "../../src/client/ai/SamPlacementPolicy";
import { UnitType } from "../../src/core/game/Game";

const CANDIDATES = 100_000;
const SAMPLES = 7;
const structures = [
  { type: UnitType.MissileSilo, existingCoverage: 0 },
  { type: UnitType.Factory, existingCoverage: 1 },
  { type: UnitType.City, existingCoverage: 0 },
  { type: UnitType.Port, existingCoverage: 2 },
];
const samples: number[] = [];
let checksum = 0;
for (let sample = 0; sample < SAMPLES; sample++) {
  const start = performance.now();
  for (let candidate = 0; candidate < CANDIDATES; candidate++) {
    checksum += scoreSamPlacement({
      protectedStructures: structures,
      depth: candidate % 120,
      isShore: candidate % 7 === 0,
      nearestSamDistance: candidate % 160,
      samRange: 100,
    }).score;
  }
  samples.push(performance.now() - start);
}
if (checksum === 0) throw new Error("SAM benchmark was optimized away");
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(samples.length / 2)];
console.log("SAM placement benchmark");
console.log(`workload: ${CANDIDATES.toLocaleString()} candidates`);
console.log(
  `p50: ${p50.toFixed(2)}ms (${(p50 / CANDIDATES).toFixed(6)}ms/candidate)`,
);
if (p50 / CANDIDATES > 0.001) process.exitCode = 1;
