import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const trainerSource = readFileSync(
  join(process.cwd(), "src/client/ai/VisualAiTrainer.ts"),
  "utf-8",
);

describe("Visual AI immediate tribe response integration", () => {
  it("retaliates against an attacking tribe before routine forecasting", () => {
    const retaliation = trainerSource.indexOf(
      '"Punish an attacking tribe immediately"',
    );
    const opponentForecasting = trainerSource.indexOf(
      "const opponentPlayers = this.game",
    );

    expect(retaliation).toBeGreaterThan(0);
    expect(opponentForecasting).toBeGreaterThan(retaliation);
  });

  it("joins a third-party attack on a bordering tribe immediately", () => {
    const contestedStage = trainerSource.indexOf(
      'this.setPlanningStage("contested-tribe")',
    );
    const decision = trainerSource.indexOf(
      '"Join the attack on a contested tribe"',
    );
    const opponentForecasting = trainerSource.indexOf(
      "const opponentPlayers = this.game",
    );

    expect(contestedStage).toBeGreaterThan(0);
    expect(decision).toBeGreaterThan(contestedStage);
    expect(opponentForecasting).toBeGreaterThan(decision);
  });

  it("uses projected live-troop capture speed in normal defensive counters", () => {
    expect(trainerSource).toContain("projectedRelativeCaptureSpeed");
    expect(trainerSource).toContain('"Slow the active force to a crawl"');
    expect(trainerSource).toContain("remainingIncomingTroops");
  });
});
