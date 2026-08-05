import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const trainerSource = readFileSync(
  join(process.cwd(), "src/client/ai/VisualAiTrainer.ts"),
  "utf-8",
);

describe("Visual AI wilderness integration", () => {
  it("plans and emits a Terra Nullius attack", () => {
    expect(trainerSource).toContain("planWildernessExpansion({");
    expect(trainerSource).toContain(
      "new SendAttackIntentEvent(null, wildernessTroops)",
    );
    expect(trainerSource).toContain('"Expand into wilderness immediately"');
  });

  it("gives free land first refusal before routine alliance work", () => {
    const wildernessStage = trainerSource.indexOf(
      'this.setPlanningStage("wilderness-growth")',
    );
    const laterAllianceStage = trainerSource.indexOf(
      'this.setPlanningStage("alliance-coordination")',
      wildernessStage,
    );

    expect(wildernessStage).toBeGreaterThan(0);
    expect(laterAllianceStage).toBeGreaterThan(wildernessStage);
  });

  it("detects an existing neutral attack by Terra Nullius target id", () => {
    expect(trainerSource).toContain("attack.targetID === 0");
  });
});
