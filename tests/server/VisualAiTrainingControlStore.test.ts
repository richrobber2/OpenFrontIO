import { describe, expect, test } from "vitest";
import {
  defaultVisualAiTrainingControl,
  parseVisualAiTrainingControl,
  visualAiChoiceCategories,
} from "../../src/server/VisualAiTrainingControlStore";

describe("VisualAiTrainingControlStore", () => {
  test("defaults to an active trainer with every bounded choice", () => {
    const control = defaultVisualAiTrainingControl();
    expect(control.paused).toBe(false);
    expect(control.allowedChoices).toEqual([...visualAiChoiceCategories]);
  });

  test("normalizes duplicates and advances the supplied revision", () => {
    const control = parseVisualAiTrainingControl(
      {
        paused: true,
        allowedChoices: ["naval", "naval", "expansion"],
      },
      7,
    );
    expect(control).toMatchObject({
      revision: 7,
      paused: true,
      allowedChoices: ["naval", "expansion"],
    });
  });

  test("rejects unknown choices", () => {
    expect(() =>
      parseVisualAiTrainingControl(
        { paused: false, allowedChoices: ["delete-everything"] },
        1,
      ),
    ).toThrow("Invalid AI training control");
  });
});
