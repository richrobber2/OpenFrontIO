import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const predictionActions = new Set([
  "attack",
  "expand",
  "fleet",
  "defend",
  "hold",
]);
const actionHistoryAllowedKeys = new Set([
  "tick",
  "action",
  "reserveRatio",
  "enemyRatio",
  "expectedTroops",
  "expectedTiles",
  "actualTroops",
  "actualTiles",
  "error",
  "startingGold",
  "startingTiles",
  "startingTroops",
  "startingMaxTroops",
  "settleTick",
  "outcomeReward",
  "attributionWeight",
]);
const optionalActionHistoryNumbers = [
  "actualTroops",
  "actualTiles",
  "error",
  "startingGold",
  "startingTiles",
  "startingTroops",
  "startingMaxTroops",
  "settleTick",
  "outcomeReward",
  "attributionWeight",
] as const;

export type VisualAiActionHistoryEntry = {
  tick: number;
  action: string;
  reserveRatio: number;
  enemyRatio: number;
  expectedTroops: number;
  expectedTiles: number;
  actualTroops?: number;
  actualTiles?: number;
  error?: number;
  startingGold?: number;
  startingTiles?: number;
  startingTroops?: number;
  startingMaxTroops?: number;
  settleTick?: number;
  outcomeReward?: number;
  attributionWeight?: number;
};

export type VisualAiBrainProfile = Record<
  string,
  | number
  | VisualAiActionHistoryEntry[]
  | Array<"win" | "loss">
  | Record<string, { mean: number; samples: number }>
>;

export type VisualAiBrain = {
  version: 1;
  updatedAt: string;
  profile: VisualAiBrainProfile;
};

const brainPath = path.resolve("data", "visual-ai-brain.json");
let saveQueue = Promise.resolve();

function boundedFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e15
  );
}

function validActionHistory(
  value: unknown,
): value is VisualAiActionHistoryEntry[] {
  if (!Array.isArray(value) || value.length > 128) return false;
  return value.every((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return false;
    }
    const entry = candidate as Record<string, unknown>;
    return (
      Object.keys(entry).every((key) => actionHistoryAllowedKeys.has(key)) &&
      boundedFiniteNumber(entry.tick) &&
      typeof entry.action === "string" &&
      predictionActions.has(entry.action) &&
      boundedFiniteNumber(entry.reserveRatio) &&
      boundedFiniteNumber(entry.enemyRatio) &&
      boundedFiniteNumber(entry.expectedTroops) &&
      boundedFiniteNumber(entry.expectedTiles) &&
      optionalActionHistoryNumbers.every(
        (key) => entry[key] === undefined || boundedFiniteNumber(entry[key]),
      )
    );
  });
}

function validRecentMatchResults(
  value: unknown,
): value is Array<"win" | "loss"> {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every((result) => result === "win" || result === "loss")
  );
}

function validActionRewardBaselines(
  value: unknown,
): value is Record<string, { mean: number; samples: number }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length === predictionActions.size &&
    entries.every(
      ([action, baseline]) =>
        predictionActions.has(action) &&
        typeof baseline === "object" &&
        baseline !== null &&
        !Array.isArray(baseline) &&
        Object.keys(baseline).every(
          (key) => key === "mean" || key === "samples",
        ) &&
        boundedFiniteNumber((baseline as { mean?: unknown }).mean) &&
        boundedFiniteNumber((baseline as { samples?: unknown }).samples),
    )
  );
}

export function validVisualAiBrainProfile(
  value: unknown,
): value is VisualAiBrainProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 64 &&
    entries.every(
      ([key, entry]) =>
        /^[a-z][a-zA-Z0-9]{0,63}$/.test(key) &&
        key !== "constructor" &&
        key !== "prototype" &&
        (key === "actionHistory"
          ? validActionHistory(entry)
          : key === "recentMatchResults"
            ? validRecentMatchResults(entry)
            : key === "actionRewardBaselines"
              ? validActionRewardBaselines(entry)
              : boundedFiniteNumber(entry)),
    )
  );
}

export async function readVisualAiBrain(): Promise<VisualAiBrain | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(brainPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      typeof (parsed as { updatedAt?: unknown }).updatedAt !== "string" ||
      !validVisualAiBrainProfile((parsed as { profile?: unknown }).profile)
    ) {
      return null;
    }
    return parsed as VisualAiBrain;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function saveVisualAiBrain(profile: unknown): Promise<VisualAiBrain> {
  if (!validVisualAiBrainProfile(profile)) {
    return Promise.reject(new Error("Invalid AI brain profile"));
  }
  const safeProfile = Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((entry) =>
            typeof entry === "object" && entry !== null ? { ...entry } : entry,
          )
        : typeof value === "object" && value !== null
          ? Object.fromEntries(
              Object.entries(value).map(([entryKey, entryValue]) => [
                entryKey,
                { ...entryValue },
              ]),
            )
          : value,
    ]),
  ) as VisualAiBrainProfile;
  const operation = saveQueue.then(async () => {
    const existing = await readVisualAiBrain();
    const incomingRevision =
      typeof safeProfile.saveRevision === "number"
        ? safeProfile.saveRevision
        : 0;
    const existingRevision =
      typeof existing?.profile.saveRevision === "number"
        ? existing.profile.saveRevision
        : -1;
    if (existing !== null && existingRevision > incomingRevision) {
      return existing;
    }

    const brain: VisualAiBrain = {
      version: 1,
      updatedAt: new Date().toISOString(),
      profile: safeProfile,
    };
    await mkdir(path.dirname(brainPath), { recursive: true });
    const temporaryPath = `${brainPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(brain, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, brainPath);
    return brain;
  });
  saveQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
