import { performance } from "node:perf_hooks";
import { memoizeTileMetric } from "../../src/client/ai/FortifyGeometryCache";

const MAP_WIDTH = 2048;
const POSTS = 200;
const ANCHORS = 240;
const THREATS = 24;
const CANDIDATES = 192;
const SAMPLES = 7;

const tiles = (count: number, yBase: number, step: number) =>
  Array.from(
    { length: count },
    (_, index) => (yBase + (index % 60)) * MAP_WIDTH + ((index * step) % 1_400),
  );
const posts = tiles(POSTS, 260, 47);
const anchors = tiles(ANCHORS, 300, 31);
const threats = tiles(THREATS, 280, 71);
const candidates = tiles(CANDIDATES, 275, 53);
const distanceSquared = (a: number, b: number): number => {
  const ax = a % MAP_WIDTH;
  const bx = b % MAP_WIDTH;
  const ay = (a - ax) / MAP_WIDTH;
  const by = (b - bx) / MAP_WIDTH;
  return (ax - bx) ** 2 + (ay - by) ** 2;
};

function scoreFortifyCandidates(cached: boolean): number[] {
  const metric = (compute: (tile: number) => number) =>
    cached ? memoizeTileMetric(compute) : compute;
  const hostileDistance = metric((tile) =>
    Math.sqrt(
      Math.min(...anchors.map((anchor) => distanceSquared(tile, anchor))),
    ),
  );
  const spacing = metric((tile) =>
    Math.sqrt(Math.min(...posts.map((post) => distanceSquared(tile, post)))),
  );
  const protectedValue = metric((tile) =>
    threats.reduce(
      (sum, threat, index) =>
        sum +
        Math.max(0, 1 - Math.sqrt(distanceSquared(tile, threat)) / 120) *
          (index + 1),
      0,
    ),
  );
  const protectedCount = metric(
    (tile) =>
      threats.filter((threat) => distanceSquared(tile, threat) <= 30 ** 2)
        .length,
  );

  return candidates.map((tile) => {
    // Mirrors Fortify filtering + final scoring reusing the same tile metrics.
    if (spacing(tile) < 12 || hostileDistance(tile) < 8) return -1;
    const filterValue = protectedValue(tile);
    const filterCount = protectedCount(tile);
    return (
      spacing(tile) * 2 +
      hostileDistance(tile) +
      protectedValue(tile) * 80 +
      protectedCount(tile) * 20 +
      filterValue +
      filterCount
    );
  });
}

function timings(cached: boolean): number[] {
  const samples: number[] = [];
  let checksum = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const start = performance.now();
    const scores = scoreFortifyCandidates(cached);
    samples.push(performance.now() - start);
    checksum += scores.reduce((sum, score) => sum + score, 0);
  }
  if (!Number.isFinite(checksum)) throw new Error("invalid Fortify score");
  return samples.sort((a, b) => a - b);
}

const expected = scoreFortifyCandidates(false);
const actual = scoreFortifyCandidates(true);
if (
  expected.length !== actual.length ||
  expected.some((value, index) => value !== actual[index])
) {
  throw new Error("cached Fortify geometry changed candidate scores");
}

const before = timings(false);
const after = timings(true);
const p50 = (values: number[]) => values[Math.floor(values.length / 2)];
const beforeMs = p50(before);
const afterMs = p50(after);
const expensiveEvaluationsBefore = CANDIDATES * 8;
const expensiveEvaluationsAfter = CANDIDATES * 4;

console.log("Mass Fortify planning benchmark");
console.log(
  `workload: ${CANDIDATES} candidates, ${POSTS} posts, ${ANCHORS} anchors, ${THREATS} structures`,
);
console.log(
  `p50 repeated geometry: ${beforeMs.toFixed(2)}ms -> ${afterMs.toFixed(2)}ms (${(beforeMs / afterMs).toFixed(2)}x faster)`,
);
console.log(
  `expensive metric evaluations: ${expensiveEvaluationsBefore.toLocaleString()} -> ${expensiveEvaluationsAfter.toLocaleString()} (${((1 - expensiveEvaluationsAfter / expensiveEvaluationsBefore) * 100).toFixed(2)}% fewer)`,
);
console.log(
  `score parity: ${actual.length}/${expected.length} candidates exact`,
);
