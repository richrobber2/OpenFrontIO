import {
  sampleCoastalAccess,
  scoreTrainingSpawn,
} from "../../src/client/ai/SpawnStrategyPolicy";

const candidates = 48 * 4 * 12;
let checksum = 0;
const started = performance.now();
for (let index = 0; index < candidates; index++) {
  const originX = 80 + (index % 320);
  const originY = 60 + (index % 180);
  const coast = sampleCoastalAccess({
    originX,
    originY,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < 512 && y < 320,
    tileAt: (x, y) => y * 512 + x,
    isOceanShore: (tile) => tile % 512 >= 430,
    openWaterDirections: (tile) => 2 + (tile % 5),
  });
  checksum += scoreTrainingSpawn({
    neutralSpace: 400 + (index % 300),
    nearbyTribes: 2 + (index % 6),
    nationDistance: 40 + (index % 80),
    tribeDistance: 10 + (index % 11),
    tribeTroops: 5_000 + index * 20,
    coastDistance: coast.distance,
    openWaterDirections: coast.openWaterDirections,
  });
}
const totalMs = performance.now() - started;
if (!Number.isFinite(checksum) || totalMs > 1_000) {
  throw new Error(`spawn strategy exceeded budget: ${totalMs.toFixed(2)}ms`);
}
console.log(
  JSON.stringify({
    ok: true,
    candidates,
    totalMs: Number(totalMs.toFixed(2)),
    meanUs: Number(((totalMs * 1_000) / candidates).toFixed(3)),
    checksum: Number(checksum.toFixed(2)),
  }),
);
