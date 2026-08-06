import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const trainerSource = readFileSync(
  resolve(process.cwd(), "src/client/ai/VisualAiTrainer.ts"),
  "utf-8",
);

describe("Visual AI strategy integration", () => {
  it("uses projected defenders and bridgehead launch math", () => {
    expect(trainerSource).toContain("assessBridgeheadLaunch({");
    expect(trainerSource).toContain("projectedTargetTroops");
    expect(trainerSource).toContain("bridgeheadReachGain");
    expect(trainerSource).toContain("bridgeheadMinimumLaunchTroops");
  });

  it("values land grabs against enemy growth before committing", () => {
    expect(trainerSource).toContain("assessGrowthAwareLandGrab({");
    expect(trainerSource).toContain("projectedEnemyTroops");
    expect(trainerSource).toContain("Reject a low-value land grab");
  });

  it("passes active allied pressure and enemy growth into donation math", () => {
    expect(trainerSource).toContain("allyCommittedTroops");
    expect(trainerSource).toContain("allyCanPressureSharedEnemy");
    expect(trainerSource).toContain("sharedEnemyMaxTroops");
    expect(trainerSource).toContain("enemyGrowthAt:");
  });

  it("does not consume a planning cycle after rejecting every boat route", () => {
    const rejectionStart = trainerSource.indexOf(
      '"Reject the best reserve-fleet route"',
    );
    expect(rejectionStart).toBeGreaterThan(0);
    const rejectionBlock = trainerSource.slice(
      rejectionStart,
      rejectionStart + 900,
    );
    expect(rejectionBlock).toContain("return false;");
    expect(rejectionBlock).not.toContain("return true;");
  });

  it("launches strategic weapons at the scored target instead of the silo", () => {
    expect(trainerSource).toContain(
      "new BuildUnitIntentEvent(best.type, best.tile)",
    );
    expect(trainerSource).not.toContain(
      "new BuildUnitIntentEvent(best.type, best.planTile)",
    );
  });
});
