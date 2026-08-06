import { describe, expect, it } from "vitest";
import {
  defensiveCounterBudget,
  relativeLandAttackSpeed,
  shouldLaunchDefensiveCounter,
} from "../../src/client/ai/DecisionTriggerPolicy";
import { planContestedTribeOpportunity } from "../../src/client/ai/TribeOpportunityPolicy";

describe("counter-pressure and contested-tribe policy", () => {
  it("leaves a tiny residual invasion instead of creating a counter-invasion", () => {
    const plan = defensiveCounterBudget({
      homeTroops: 1_000_000,
      maxTroops: 1_000_000,
      totalIncomingTroops: 100_000,
      selectedIncomingTroops: 100_000,
    });

    expect(plan.counterTroops).toBeCloseTo(97_744.3609);
    expect(plan.counterTroops).toBeLessThan(100_000);
    expect(plan.remainingIncomingTroops).toBeGreaterThan(0);
    expect(plan.projectedAttackerToDefenderRatio).toBeCloseTo(0.0025);
    expect(plan.projectedRelativeCaptureSpeed).toBeCloseTo(0.05);
  });

  it("does not spend troops when an invasion is already crawling", () => {
    const plan = defensiveCounterBudget({
      homeTroops: 1_000_000,
      maxTroops: 1_000_000,
      totalIncomingTroops: 2_000,
      selectedIncomingTroops: 2_000,
    });

    expect(plan.counterTroops).toBe(0);
    expect(plan.remainingIncomingTroops).toBe(2_000);
    expect(plan.currentRelativeCaptureSpeed).toBeCloseTo(0.04);
  });

  it("still respects the multi-front capacity floor when a crawl is unaffordable", () => {
    const plan = defensiveCounterBudget({
      homeTroops: 2_582_484,
      maxTroops: 3_491_371,
      totalIncomingTroops: 1_600_000,
      selectedIncomingTroops: 1_450_000,
      activeIncomingFronts: 3,
    });

    expect(plan.protectedTroops).toBeCloseTo(2_094_822.6);
    expect(plan.counterTroops).toBeCloseTo(487_661.4);
    expect(plan.projectedRelativeCaptureSpeed).toBeGreaterThan(0.1);
  });

  it("launches a below-normal counter when it halves speed and reaches a crawl", () => {
    const plan = defensiveCounterBudget({
      homeTroops: 1_000_000,
      maxTroops: 1_000_000,
      totalIncomingTroops: 50_000,
      selectedIncomingTroops: 50_000,
    });

    expect(plan.counterTroops / 1_000_000).toBeLessThan(0.08);
    expect(
      shouldLaunchDefensiveCounter({
        homeTroops: 1_000_000,
        selectedIncomingTroops: 50_000,
        counterTroops: plan.counterTroops,
        currentRelativeCaptureSpeed: plan.currentRelativeCaptureSpeed,
        projectedRelativeCaptureSpeed: plan.projectedRelativeCaptureSpeed,
      }),
    ).toBe(true);
  });

  it("matches the engine's live-defender attack-speed relationship", () => {
    expect(relativeLandAttackSpeed(2_500, 1_000_000)).toBeCloseTo(0.05);
    expect(relativeLandAttackSpeed(100_000, 1_000_000)).toBe(1);
    expect(relativeLandAttackSpeed(10, 1_000_000)).toBeCloseTo(0.02);
  });

  const contested = {
    targetUnderAttack: true,
    targetIncomingTroops: 150_000,
    ownTroops: 550_000,
    maxTroops: 1_000_000,
    reserveFloor: 0.48,
    incomingFronts: 0,
    outgoingFronts: 0,
    maximumFronts: 5,
    alreadyAttackingTarget: false,
    targetTroops: 300_000,
    terrainLossCost: 1,
    wrapPotential: 0.2,
  };

  it("joins an attack on a tribe on the first safe planning pass", () => {
    const plan = planContestedTribeOpportunity(contested);

    expect(plan.attack).toBe(true);
    expect(plan.fraction).toBeGreaterThanOrEqual(0.03);
    expect(plan.projectedReserveRatio).toBeCloseTo(0.48);
    expect(plan.pressureRatio).toBeCloseTo(0.5);
  });

  it("commits less when the outside attacker is already doing more work", () => {
    const lightPressure = planContestedTribeOpportunity({
      ...contested,
      ownTroops: 800_000,
      targetIncomingTroops: 30_000,
    });
    const heavyPressure = planContestedTribeOpportunity({
      ...contested,
      ownTroops: 800_000,
      targetIncomingTroops: 270_000,
    });

    expect(lightPressure.attack).toBe(true);
    expect(heavyPressure.attack).toBe(true);
    expect(heavyPressure.fraction).toBeLessThan(lightPressure.fraction);
  });

  it("does not dogpile while home is attacked or the target/front is already active", () => {
    expect(
      planContestedTribeOpportunity({ ...contested, incomingFronts: 1 }).attack,
    ).toBe(false);
    expect(
      planContestedTribeOpportunity({
        ...contested,
        alreadyAttackingTarget: true,
      }).attack,
    ).toBe(false);
    expect(
      planContestedTribeOpportunity({
        ...contested,
        outgoingFronts: 5,
      }).attack,
    ).toBe(false);
  });
});
