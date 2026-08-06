import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const visualAiChoiceCategories = [
  "land-attack",
  "expansion",
  "naval",
  "strategic",
  "diplomacy",
] as const;

export type VisualAiChoiceCategory = (typeof visualAiChoiceCategories)[number];

export type VisualAiTrainingControl = {
  version: 1;
  revision: number;
  updatedAt: string;
  paused: boolean;
  allowedChoices: VisualAiChoiceCategory[];
};

const controlPath = path.resolve("data", "visual-ai-training-control.json");
const allowed = new Set<string>(visualAiChoiceCategories);
let saveQueue = Promise.resolve();

export function defaultVisualAiTrainingControl(): VisualAiTrainingControl {
  return {
    version: 1,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    paused: false,
    allowedChoices: [...visualAiChoiceCategories],
  };
}

export function parseVisualAiTrainingControl(
  value: unknown,
  revision: number,
): VisualAiTrainingControl {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid AI training control");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.paused !== "boolean" ||
    !Array.isArray(input.allowedChoices) ||
    input.allowedChoices.some(
      (choice) => typeof choice !== "string" || !allowed.has(choice),
    )
  ) {
    throw new Error("Invalid AI training control");
  }
  return {
    version: 1,
    revision,
    updatedAt: new Date().toISOString(),
    paused: input.paused,
    allowedChoices: [
      ...new Set(input.allowedChoices as VisualAiChoiceCategory[]),
    ],
  };
}

export async function readVisualAiTrainingControl(): Promise<VisualAiTrainingControl> {
  try {
    const parsed = JSON.parse(await readFile(controlPath, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Number.isSafeInteger((parsed as { revision?: unknown }).revision)
    ) {
      return defaultVisualAiTrainingControl();
    }
    const stored = parsed as VisualAiTrainingControl;
    return parseVisualAiTrainingControl(stored, stored.revision);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultVisualAiTrainingControl();
    }
    throw error;
  }
}

export function saveVisualAiTrainingControl(
  value: unknown,
): Promise<VisualAiTrainingControl> {
  const operation = saveQueue.then(async () => {
    const previous = await readVisualAiTrainingControl();
    const control = parseVisualAiTrainingControl(value, previous.revision + 1);
    await mkdir(path.dirname(controlPath), { recursive: true });
    const temporaryPath = `${controlPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(control, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, controlPath);
    return control;
  });
  saveQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
