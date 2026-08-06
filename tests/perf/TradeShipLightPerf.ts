import { performance } from "node:perf_hooks";
import { shouldEmitTradeShipLight } from "../../src/client/render/gl/utils/TradeShipLightGrid";

const SHIPS = 100_000;
const RUNS = 7;
const samples: number[] = [];
let emitted = 0;
for (let run = 0; run < RUNS; run++) {
  const cells = new Set<number>();
  let runEmitted = 0;
  const start = performance.now();
  for (let ship = 0; ship < SHIPS; ship++) {
    const x = (ship * 13) % 2_000;
    const y = Math.floor(ship / 250) % 1_200;
    if (shouldEmitTradeShipLight(cells, x, y, 2_000, runEmitted)) {
      runEmitted++;
    }
  }
  samples.push(performance.now() - start);
  emitted = runEmitted;
}
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(samples.length / 2)];
const reduction = 1 - emitted / SHIPS;
console.log("Trade-ship light batching benchmark");
console.log(`workload: ${SHIPS.toLocaleString()} trade ships`);
console.log(
  `emitted: ${emitted.toLocaleString()} lights (${(reduction * 100).toFixed(1)}% reduction)`,
);
console.log(`p50 CPU: ${p50.toFixed(2)}ms`);
if (reduction < 0.95 || p50 > 15) process.exitCode = 1;
