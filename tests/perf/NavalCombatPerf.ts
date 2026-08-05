import { performance } from "node:perf_hooks";
import { selectWarshipDeployment } from "../../src/client/ai/NavalCombatPolicy";

const FLEET_SIZE = 128;
const DECISIONS = 1_000;
const SAMPLES = 7;
const fleet = Array.from({ length: FLEET_SIZE }, (_, id) => ({
  id,
  health: 30 + ((id * 37) % 131),
  veterancy: id % 4,
  distanceSquared: 100 + ((id * 7919) % 100_000),
}));

const samples: number[] = [];
let selectedShips = 0;
for (let sample = 0; sample < SAMPLES; sample++) {
  const start = performance.now();
  for (let decision = 0; decision < DECISIONS; decision++) {
    selectedShips += selectWarshipDeployment(
      fleet,
      4,
      16,
      1.15,
      100,
      20,
      20,
    ).length;
  }
  samples.push(performance.now() - start);
}
if (selectedShips === 0) throw new Error("naval benchmark selected no ships");
samples.sort((a, b) => a - b);
const p50Ms = samples[Math.floor(samples.length / 2)];
console.log("Naval combat planning benchmark");
console.log(
  `workload: ${DECISIONS.toLocaleString()} decisions with ${FLEET_SIZE} warships`,
);
console.log(
  `p50: ${p50Ms.toFixed(2)}ms (${Math.round(DECISIONS / (p50Ms / 1000)).toLocaleString()} decisions/s, ${(p50Ms / DECISIONS).toFixed(4)}ms/decision)`,
);
