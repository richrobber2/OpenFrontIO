import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "openfront-brain-perf-"),
);
const originalCwd = process.cwd();

try {
  process.chdir(temporaryRoot);
  const { readVisualAiBrain, saveVisualAiBrain, validVisualAiBrainProfile } =
    await import("../../src/server/VisualAiBrainStore");
  const profile = {
    saveRevision: 1,
    savedAt: Date.now(),
    matches: 51,
    wins: 4,
    recentMatchResults: ["loss", "win"] as Array<"win" | "loss">,
    actionRewardBaselines: Object.fromEntries(
      ["attack", "expand", "fleet", "defend", "hold"].map((action) => [
        action,
        { mean: 0.1, samples: 20 },
      ]),
    ),
    actionHistory: Array.from({ length: 128 }, (_, index) => ({
      tick: index,
      action: "defend",
      reserveRatio: 0.5,
      enemyRatio: 1.2,
      expectedTroops: 100_000,
      expectedTiles: 10_000,
      actualTroops: 95_000,
      actualTiles: 10_100,
      error: 0.05,
      outcomeReward: 0.1,
      attributionWeight: 0.8,
    })),
  };

  const validationStartedAt = performance.now();
  let validCount = 0;
  for (let index = 0; index < 10_000; index += 1) {
    if (validVisualAiBrainProfile(profile)) validCount += 1;
  }
  const validationMs = performance.now() - validationStartedAt;

  const writeStartedAt = performance.now();
  for (let revision = 1; revision <= 25; revision += 1) {
    await saveVisualAiBrain({ ...profile, saveRevision: revision });
  }
  const writeMs = performance.now() - writeStartedAt;
  const saved = await readVisualAiBrain();

  if (validCount !== 10_000 || saved?.profile.saveRevision !== 25) {
    throw new Error("brain persistence benchmark produced invalid output");
  }
  console.log(
    JSON.stringify({
      ok: true,
      validations: validCount,
      validationMs: Number(validationMs.toFixed(2)),
      validationMicroseconds: Number(
        ((validationMs * 1_000) / validCount).toFixed(3),
      ),
      atomicWrites: 25,
      writeMs: Number(writeMs.toFixed(2)),
    }),
  );
  if (validationMs > 2_000 || writeMs > 2_000) process.exitCode = 1;
} finally {
  process.chdir(originalCwd);
  await rm(temporaryRoot, { recursive: true, force: true });
}
