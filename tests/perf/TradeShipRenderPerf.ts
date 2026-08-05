import { performance } from "node:perf_hooks";
import { isMissileAtlasColumn } from "../../src/client/render/gl/utils/UnitAtlasClassification";

const SHIPS = 100_000;
const RUNS = 7;
const missileTypes = new Set([
  "Atom Bomb",
  "Hydrogen Bomb",
  "MIRV",
  "SAM Missile",
  "Shell",
  "MIRV Warhead",
]);
const legacyFlickerHash = (x: number, y: number) => {
  const value = x * 0.1731 + y * 0.3179;
  return ((value - Math.floor(value)) * 255) | 0;
};

function measure(optimized: boolean): number {
  const samples: number[] = [];
  let checksum = 0;
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    if (optimized) {
      for (let ship = 0; ship < SHIPS; ship++) {
        checksum += isMissileAtlasColumn(1) ? 1 : 0;
      }
    } else {
      for (let ship = 0; ship < SHIPS; ship++) {
        checksum +=
          (missileTypes.has("Trade Ship") ? 1 : 0) +
          legacyFlickerHash(ship % 2_000, Math.floor(ship / 2_000));
      }
    }
    samples.push(performance.now() - start);
  }
  if (checksum === Number.MIN_VALUE)
    throw new Error("render benchmark was optimized away");
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const legacyMs = measure(false);
const optimizedMs = measure(true);
const speedup = legacyMs / Math.max(0.001, optimizedMs);
console.log("Trade-ship render packing benchmark");
console.log(`workload: ${SHIPS.toLocaleString()} trade ships`);
console.log(`legacy p50: ${legacyMs.toFixed(2)}ms`);
console.log(
  `optimized p50: ${optimizedMs.toFixed(2)}ms (${speedup.toFixed(1)}x faster)`,
);
if (speedup < 1.05 || optimizedMs > 5.5) process.exitCode = 1;
