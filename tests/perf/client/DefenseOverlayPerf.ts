/**
 * Repeatable numerical check for defense-overlay invalidation.
 *
 * Models 300 structure snapshots containing 160 SAMs. A defense post is added
 * every ten snapshots; all other snapshots represent unrelated structure
 * churn that previously caused the same GPU upload/full coverage stamp.
 */
import { performance } from "node:perf_hooks";
import { defensePostBlockBounds } from "../../../src/client/render/gl/utils/DefenseCoverageInvalidation";
import { collectCompletedDefensePosts } from "../../../src/client/render/gl/utils/DefensePostCollection";
import {
  sameDefensePosts,
  sameNumberSet,
  type DefensePostPosition,
} from "../../../src/client/render/gl/utils/OverlayInvalidation";
import {
  computeUncoveredArcs,
  type SAMCircle,
} from "../../../src/client/render/gl/utils/SamRadiusGeometry";
import {
  captureStructureIcons,
  sameStructureIcons,
} from "../../../src/client/render/gl/utils/StructureIconInvalidation";
import {
  captureStructureLevels,
  sameStructureLevels,
} from "../../../src/client/render/gl/utils/StructureLevelInvalidation";
import { updateStructureShapeBuffers } from "../../../src/client/render/gl/utils/StructureShapeUniforms";

const UPDATES = 300;
const SAMS = 160;
const POST_EVERY = 10;
const FLOAT_BYTES = 4;
const POST_FLOATS = 3;
const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;
const SAMPLES = 7;
const jsonOutput = process.argv.includes("--json");

const circles: SAMCircle[] = Array.from({ length: SAMS }, (_, i) => ({
  x: (i % 20) * 19,
  y: Math.floor(i / 20) * 19,
  radius: 30,
  color: [1, 0, 0],
  group: i % 3,
}));

function buildSamGeometry(repetitions: number): number {
  let emittedArcs = 0;
  for (let update = 0; update < repetitions; update++) {
    for (const circle of circles) {
      emittedArcs += computeUncoveredArcs(circle, circles).length;
    }
  }
  return emittedArcs;
}

interface TimingStats {
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.ceil((sorted.length - 1) * fraction)];
}

function runtimeStats(repetitions: number): TimingStats {
  const samples: number[] = [];
  let checksum = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const start = performance.now();
    checksum ^= buildSamGeometry(repetitions);
    samples.push(performance.now() - start);
  }
  // Keep the geometry work observable to the runtime.
  if (checksum < 0) throw new Error("unreachable checksum");
  samples.sort((a, b) => a - b);
  return {
    minMs: samples[0],
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples[samples.length - 1],
  };
}

function timeOperation(operation: () => void): TimingStats {
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    minMs: samples[0],
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples[samples.length - 1],
  };
}

let legacyUploadBytes = 0;
let cachedUploadBytes = 0;
let posts = 0;
let postChanges = 0;
const postList: DefensePostPosition[] = [];
for (let update = 0; update < UPDATES; update++) {
  if (update % POST_EVERY === 0) {
    posts++;
    postChanges++;
    postList.push({ x: update, y: update % 47, ownerID: update % 72 });
  }
  const bytes = posts * POST_FLOATS * FLOAT_BYTES;
  legacyUploadBytes += bytes;
  if (update % POST_EVERY === 0) cachedUploadBytes += bytes;
}

// Warm the geometry path before collecting medians.
buildSamGeometry(1);
const legacyTiming = runtimeStats(UPDATES);
const deferredTiming = runtimeStats(1);
const reduction = (before: number, after: number) => (1 - after / before) * 100;
const fullMapPixels = MAP_WIDTH * MAP_HEIGHT;
const coverageBlockSize = 128;
const defenseRange = 30;
let localizedClearPixels = 0;
let localizedBlockRestamps = 0;
for (const post of postList) {
  const bounds = defensePostBlockBounds(
    post.x,
    post.y,
    defenseRange,
    MAP_WIDTH,
    MAP_HEIGHT,
    coverageBlockSize,
  );
  for (let by = bounds.minY; by <= bounds.maxY; by++) {
    for (let bx = bounds.minX; bx <= bounds.maxX; bx++) {
      localizedBlockRestamps++;
      localizedClearPixels +=
        Math.min(coverageBlockSize, MAP_WIDTH - bx * coverageBlockSize) *
        Math.min(coverageBlockSize, MAP_HEIGHT - by * coverageBlockSize);
    }
  }
}
const arcsPerRebuild = buildSamGeometry(1);
const comparisonsPerRebuild = SAMS * (SAMS - 1);
const packedPosts = postList.flatMap((post) => [post.x, post.y, post.ownerID]);
if (!sameDefensePosts(postList, packedPosts)) {
  throw new Error("identical defense-post state was not recognized");
}
if (sameDefensePosts([...postList, { x: 1, y: 2, ownerID: 3 }], packedPosts)) {
  throw new Error("changed defense-post state was incorrectly cached");
}
const allySet = new Set(Array.from({ length: 72 }, (_, id) => id));
if (!sameNumberSet(allySet, new Set(allySet))) {
  throw new Error("identical ally state was not recognized");
}
const cacheChecks = 100_000;
const postCacheTiming = timeOperation(() => {
  for (let i = 0; i < cacheChecks; i++) sameDefensePosts(postList, packedPosts);
});
const allyCacheTiming = timeOperation(() => {
  for (let i = 0; i < cacheChecks; i++) sameNumberSet(allySet, allySet);
});
const collectionUpdates = 2_000;
const collectionUnits = new Map(
  Array.from({ length: 1_000 }, (_, id) => [
    id,
    {
      unitType: id % 5 === 0 ? "Defense Post" : "City",
      underConstruction: id % 31 === 0,
      pos: id * 97,
      ownerID: id % 72,
    },
  ]),
);
function collectLegacyPosts(): DefensePostPosition[] {
  const result: DefensePostPosition[] = [];
  for (const unit of collectionUnits.values()) {
    if (unit.unitType === "Defense Post" && !unit.underConstruction) {
      const x = unit.pos % MAP_WIDTH;
      result.push({
        x,
        y: (unit.pos - (unit.pos % MAP_WIDTH)) / MAP_WIDTH,
        ownerID: unit.ownerID,
      });
    }
  }
  return result;
}
const legacyCollectionTiming = timeOperation(() => {
  for (let i = 0; i < collectionUpdates; i++) collectLegacyPosts();
});
const reusablePosts: DefensePostPosition[] = [];
const collectionTiming = timeOperation(() => {
  for (let i = 0; i < collectionUpdates; i++) {
    collectCompletedDefensePosts(collectionUnits, MAP_WIDTH, reusablePosts);
  }
});
const completedPostCount = reusablePosts.length;
const structureOrder = [
  "City",
  "Port",
  "Factory",
  "Defense Post",
  "SAM Launcher",
  "Missile Silo",
];
const structureShapes = Object.fromEntries(
  structureOrder.map((name, index) => [
    name,
    { scale: 0.8 + index * 0.05, iconFill: 0.5 + index * 0.04 },
  ]),
);
const shapeFrames = 60 * 60;
const legacyShapeTiming = timeOperation(() => {
  for (let frame = 0; frame < shapeFrames; frame++) {
    const scales = new Float32Array(structureOrder.length);
    const fills = new Float32Array(structureOrder.length);
    for (let i = 0; i < structureOrder.length; i++) {
      const shape = structureShapes[structureOrder[i]];
      scales[i] = shape.scale;
      fills[i] = shape.iconFill;
    }
  }
});
const shapeScales = new Float32Array(structureOrder.length);
const iconFills = new Float32Array(structureOrder.length);
const shapeTiming = timeOperation(() => {
  shapeScales.fill(0);
  iconFills.fill(0);
  let changedFrames = 0;
  for (let frame = 0; frame < shapeFrames; frame++) {
    if (
      updateStructureShapeBuffers(
        structureOrder,
        structureShapes,
        shapeScales,
        iconFills,
      )
    ) {
      changedFrames++;
    }
  }
  if (changedFrames !== 1)
    throw new Error("shape uniform cache missed a frame");
});
const levelTypes = new Set(structureOrder);
const levelUnits = new Map(
  Array.from({ length: 1_000 }, (_, id) => [
    id,
    {
      isActive: id % 11 !== 0,
      unitType: structureOrder[id % structureOrder.length],
      level: (id % 8) + 1,
      pos: id * 101,
    },
  ]),
);
const levelSnapshot: { unitType: string; level: number; pos: number }[] = [];
captureStructureLevels(levelUnits, levelTypes, levelSnapshot);
const stableLevelUpdates = 2_000;
const legacyLevelBuffer = new Float32Array(levelSnapshot.length * 4 * 5);
const legacyLevelTiming = timeOperation(() => {
  let checksum = 0;
  for (let update = 0; update < stableLevelUpdates; update++) {
    let digit = 0;
    for (const unit of levelUnits.values()) {
      if (!unit.isActive || unit.level <= 1) continue;
      const level = unit.level.toString();
      const x = unit.pos % MAP_WIDTH;
      const y = (unit.pos - x) / MAP_WIDTH;
      for (let i = 0; i < level.length; i++) {
        const offset = digit++ * 5;
        legacyLevelBuffer[offset] = x;
        legacyLevelBuffer[offset + 1] = y;
        legacyLevelBuffer[offset + 2] = i;
        legacyLevelBuffer[offset + 3] = level.charCodeAt(i);
        legacyLevelBuffer[offset + 4] = unit.level % structureOrder.length;
      }
      checksum += level.length;
    }
  }
  if (checksum === 0) throw new Error("level workload was empty");
});
const cachedLevelTiming = timeOperation(() => {
  for (let update = 0; update < stableLevelUpdates; update++) {
    if (!sameStructureLevels(levelUnits, levelTypes, levelSnapshot)) {
      throw new Error("stable level snapshot changed");
    }
  }
});
const changedLevelUnit = levelUnits.get(7)!;
changedLevelUnit.level++;
if (sameStructureLevels(levelUnits, levelTypes, levelSnapshot)) {
  throw new Error("level change was not detected");
}
changedLevelUnit.level--;
const iconUnits = new Map(
  Array.from({ length: 1_000 }, (_, id) => [
    id,
    {
      isActive: id % 11 !== 0,
      unitType: structureOrder[id % structureOrder.length],
      pos: id * 101,
      ownerID: id % 72,
      underConstruction: id % 19 === 0,
      markedForDeletion: id % 97 === 0 ? id : (false as const),
    },
  ]),
);
const iconSnapshot: {
  unitType: string;
  pos: number;
  ownerID: number;
  underConstruction: boolean;
  markedForDeletion: boolean;
}[] = [];
captureStructureIcons(iconUnits, levelTypes, iconSnapshot);
const iconUpdates = 2_000;
const legacyIconBuffer = new Float32Array(iconSnapshot.length * 6);
const legacyIconTiming = timeOperation(() => {
  for (let update = 0; update < iconUpdates; update++) {
    let count = 0;
    for (const unit of iconUnits.values()) {
      if (!unit.isActive || !levelTypes.has(unit.unitType)) continue;
      const offset = count++ * 6;
      const x = unit.pos % MAP_WIDTH;
      legacyIconBuffer[offset] = x;
      legacyIconBuffer[offset + 1] = (unit.pos - x) / MAP_WIDTH;
      legacyIconBuffer[offset + 2] = unit.ownerID;
      legacyIconBuffer[offset + 3] = unit.underConstruction ? 1 : 0;
      legacyIconBuffer[offset + 4] = structureOrder.indexOf(unit.unitType);
      legacyIconBuffer[offset + 5] = unit.markedForDeletion !== false ? 1 : 0;
    }
  }
});
const cachedIconTiming = timeOperation(() => {
  for (let update = 0; update < iconUpdates; update++) {
    if (!sameStructureIcons(iconUnits, levelTypes, iconSnapshot)) {
      throw new Error("stable icon snapshot changed");
    }
  }
});
const changedIconUnit = iconUnits.get(5)!;
changedIconUnit.ownerID++;
if (sameStructureIcons(iconUnits, levelTypes, iconSnapshot)) {
  throw new Error("icon owner change was not detected");
}
changedIconUnit.ownerID--;

const metrics = {
  workload: {
    updates: UPDATES,
    sams: SAMS,
    finalPosts: posts,
    postChanges,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    samples: SAMPLES,
  },
  sam: {
    rebuilds: { before: UPDATES, after: 1 },
    timingMs: { before: legacyTiming, after: deferredTiming },
    p50Speedup: legacyTiming.p50Ms / deferredTiming.p50Ms,
    p50CpuReductionPercent: reduction(legacyTiming.p50Ms, deferredTiming.p50Ms),
    pairEvaluations: {
      perRebuild: comparisonsPerRebuild,
      before: comparisonsPerRebuild * UPDATES,
      after: comparisonsPerRebuild,
    },
    emittedArcs: {
      perRebuild: arcsPerRebuild,
      before: arcsPerRebuild * UPDATES,
      after: arcsPerRebuild,
    },
    rebuildsPerSecond: {
      before: UPDATES / (legacyTiming.p50Ms / 1000),
      after: 1 / (deferredTiming.p50Ms / 1000),
    },
  },
  coverage: {
    restamps: { before: UPDATES, after: postChanges },
    restampReductionPercent: reduction(UPDATES, postChanges),
    fullMapClearPixels: {
      before: fullMapPixels * UPDATES,
      cachedPosts: fullMapPixels * postChanges,
      localized: localizedClearPixels,
    },
    localizedBlockRestamps,
    localizedPixelReductionPercent: reduction(
      fullMapPixels * postChanges,
      localizedClearPixels,
    ),
    uploads: { before: UPDATES, after: postChanges },
    uploadBytes: { before: legacyUploadBytes, after: cachedUploadBytes },
    uploadReductionPercent: reduction(legacyUploadBytes, cachedUploadBytes),
    averageUploadBytesPerUpdate: {
      before: legacyUploadBytes / UPDATES,
      after: cachedUploadBytes / UPDATES,
    },
    postCacheChecks: {
      operations: cacheChecks,
      timingMs: postCacheTiming,
      operationsPerSecond: cacheChecks / (postCacheTiming.p50Ms / 1000),
    },
    postCollection: {
      updates: collectionUpdates,
      unitsPerUpdate: collectionUnits.size,
      postsPerUpdate: completedPostCount,
      timingMs: { before: legacyCollectionTiming, after: collectionTiming },
      p50Speedup: legacyCollectionTiming.p50Ms / collectionTiming.p50Ms,
      updatesPerSecond: collectionUpdates / (collectionTiming.p50Ms / 1000),
      containerAllocations: { before: collectionUpdates, after: 1 },
      postObjectAllocations: {
        before: collectionUpdates * completedPostCount,
        after: completedPostCount,
      },
    },
  },
  relations: {
    allyCacheChecks: {
      operations: cacheChecks,
      setSize: allySet.size,
      timingMs: allyCacheTiming,
      operationsPerSecond: cacheChecks / (allyCacheTiming.p50Ms / 1000),
    },
  },
  structureShapes: {
    frames: shapeFrames,
    timingMs: { before: legacyShapeTiming, after: shapeTiming },
    typedArrayAllocations: { before: shapeFrames * 2, after: 2 },
    uniformUploads: { before: shapeFrames * 2, after: 2 },
    uploadReductionPercent: reduction(shapeFrames * 2, 2),
  },
  structureLevels: {
    updates: stableLevelUpdates,
    displayedStructures: levelSnapshot.length,
    timingMs: { before: legacyLevelTiming, after: cachedLevelTiming },
    p50Speedup: legacyLevelTiming.p50Ms / cachedLevelTiming.p50Ms,
    layouts: {
      before: stableLevelUpdates * levelSnapshot.length,
      after: levelSnapshot.length,
    },
    gpuUploads: { before: stableLevelUpdates, after: 1 },
  },
  structureIcons: {
    updates: iconUpdates,
    displayedStructures: iconSnapshot.length,
    timingMs: { before: legacyIconTiming, after: cachedIconTiming },
    p50Speedup: legacyIconTiming.p50Ms / cachedIconTiming.p50Ms,
    instanceWrites: {
      before: iconUpdates * iconSnapshot.length,
      after: iconSnapshot.length,
    },
    gpuUploads: { before: iconUpdates, after: 1 },
  },
};

if (jsonOutput) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const pct = (value: number) => `${value.toFixed(2)}%`;
  const ms = (value: number) => `${value.toFixed(2)}ms`;
  console.log("Defense overlay invalidation benchmark");
  console.log(
    `workload: ${UPDATES} updates, ${SAMS} SAMs, ${posts} posts, ${MAP_WIDTH}x${MAP_HEIGHT} map, ${SAMPLES} samples`,
  );
  console.log(
    `SAM rebuilds: ${UPDATES} -> 1 (${pct(reduction(UPDATES, 1))} fewer)`,
  );
  console.log(
    `SAM p50: ${ms(legacyTiming.p50Ms)} -> ${ms(deferredTiming.p50Ms)} (${metrics.sam.p50Speedup.toFixed(1)}x faster)`,
  );
  console.log(
    `SAM p95: ${ms(legacyTiming.p95Ms)} -> ${ms(deferredTiming.p95Ms)}`,
  );
  console.log(
    `circle-pair evaluations: ${metrics.sam.pairEvaluations.before.toLocaleString()} -> ${metrics.sam.pairEvaluations.after.toLocaleString()}`,
  );
  console.log(
    `emitted arcs: ${metrics.sam.emittedArcs.before.toLocaleString()} -> ${metrics.sam.emittedArcs.after.toLocaleString()}`,
  );
  console.log(
    `coverage restamps/uploads: ${UPDATES} -> ${postChanges} (${pct(metrics.coverage.restampReductionPercent)} fewer)`,
  );
  console.log(
    `coverage clear pixels: ${metrics.coverage.fullMapClearPixels.before.toLocaleString()} -> ${metrics.coverage.fullMapClearPixels.cachedPosts.toLocaleString()} -> ${metrics.coverage.fullMapClearPixels.localized.toLocaleString()} localized (${pct(metrics.coverage.localizedPixelReductionPercent)} below full post-change stamps)`,
  );
  console.log(
    `localized coverage blocks: ${localizedBlockRestamps.toLocaleString()} across ${postChanges} post additions`,
  );
  console.log(
    `post uploads: ${legacyUploadBytes.toLocaleString()} -> ${cachedUploadBytes.toLocaleString()} bytes (${pct(metrics.coverage.uploadReductionPercent)} fewer)`,
  );
  console.log(
    `average upload/update: ${metrics.coverage.averageUploadBytesPerUpdate.before.toFixed(1)} -> ${metrics.coverage.averageUploadBytesPerUpdate.after.toFixed(1)} bytes`,
  );
  console.log(
    `post cache checks: ${metrics.coverage.postCacheChecks.operationsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 })}/s (${ms(postCacheTiming.p50Ms)} p50 for ${cacheChecks.toLocaleString()})`,
  );
  console.log(
    `post collection p50: ${ms(legacyCollectionTiming.p50Ms)} -> ${ms(collectionTiming.p50Ms)} (${metrics.coverage.postCollection.p50Speedup.toFixed(2)}x faster, ${metrics.coverage.postCollection.updatesPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 })} updates/s)`,
  );
  console.log(
    `collection allocations: ${metrics.coverage.postCollection.postObjectAllocations.before.toLocaleString()} -> ${metrics.coverage.postCollection.postObjectAllocations.after.toLocaleString()} post objects; ${collectionUpdates.toLocaleString()} -> 1 arrays`,
  );
  console.log(
    `ally cache checks: ${metrics.relations.allyCacheChecks.operationsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 })}/s (${ms(allyCacheTiming.p50Ms)} p50 for ${cacheChecks.toLocaleString()})`,
  );
  console.log(
    `shape uniforms (60s): ${metrics.structureShapes.uniformUploads.before.toLocaleString()} -> ${metrics.structureShapes.uniformUploads.after} uploads and ${metrics.structureShapes.typedArrayAllocations.before.toLocaleString()} -> ${metrics.structureShapes.typedArrayAllocations.after} typed arrays (${pct(metrics.structureShapes.uploadReductionPercent)} fewer)`,
  );
  console.log(
    `stable level updates: ${ms(legacyLevelTiming.p50Ms)} -> ${ms(cachedLevelTiming.p50Ms)} (${metrics.structureLevels.p50Speedup.toFixed(2)}x faster); ${metrics.structureLevels.layouts.before.toLocaleString()} -> ${metrics.structureLevels.layouts.after.toLocaleString()} layouts, ${stableLevelUpdates.toLocaleString()} -> 1 GPU uploads`,
  );
  console.log(
    `stable icon updates: ${ms(legacyIconTiming.p50Ms)} -> ${ms(cachedIconTiming.p50Ms)} (${metrics.structureIcons.p50Speedup.toFixed(2)}x faster); ${metrics.structureIcons.instanceWrites.before.toLocaleString()} -> ${metrics.structureIcons.instanceWrites.after.toLocaleString()} writes, ${iconUpdates.toLocaleString()} -> 1 GPU uploads`,
  );
}
