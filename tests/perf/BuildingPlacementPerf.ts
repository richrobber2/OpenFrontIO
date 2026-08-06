import { performance } from "node:perf_hooks";
import { placementTilesExcluding } from "../../src/core/execution/nation/PlacementTileCache";

const STRUCTURES = 512;
const CANDIDATES = 20_000;
const RUNS = 7;
const structures = Array.from({ length: STRUCTURES }, (_, index) => index * 17);
const snapshot = new Set(structures);

function measure(score: (tile: number) => number): number {
  const samples: number[] = [];
  let checksum = 0;
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    for (let candidate = 0; candidate < CANDIDATES; candidate++) {
      checksum += score(
        candidate % 8 === 0
          ? structures[candidate % STRUCTURES]
          : candidate * 19,
      );
    }
    samples.push(performance.now() - start);
  }
  if (checksum === 0) throw new Error("placement benchmark was optimized away");
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const legacyMs = measure((tile) => {
  const tiles = new Set(structures);
  tiles.delete(tile);
  return tiles.size;
});
const cachedMs = measure(
  (tile) => placementTilesExcluding(snapshot, tile).size,
);
const speedup = legacyMs / cachedMs;

console.log("Bulk building-placement benchmark");
console.log(
  `workload: ${CANDIDATES.toLocaleString()} candidates, ${STRUCTURES} existing structures`,
);
console.log(`legacy p50: ${legacyMs.toFixed(2)}ms`);
console.log(
  `cached p50: ${cachedMs.toFixed(2)}ms (${speedup.toFixed(1)}x faster)`,
);
if (speedup < 2) process.exitCode = 1;
