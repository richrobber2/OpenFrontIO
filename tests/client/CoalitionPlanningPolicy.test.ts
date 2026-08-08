import { describe, expect, it } from "vitest";
import {
  planCoalitionGrowthSupport,
  selectCoalitionTarget,
} from "../../src/client/ai/CoalitionPlanningPolicy";

describe("coalition target selection", () => {
  it("chooses the enemy an ally can legally help attack", () => {
    const decision = selectCoalitionTarget([
      {
        targetId: "high-priority-blocked",
        basePriority: 10,
        ownCanReach: true,
        enemyActiveWars: 0,
        helpers: [
          {
            allyId: "ally",
            reliability: 0.8,
            reserveRatio: 0.7,
            canReach: true,
            treatyBlocked: true,
          },
        ],
      },
      {
        targetId: "slightly-lower-shared",
        basePriority: 8.8,
        ownCanReach: true,
        enemyActiveWars: 1,
        helpers: [
          {
            allyId: "ally",
            reliability: 0.8,
            reserveRatio: 0.7,
            canReach: true,
            treatyBlocked: false,
          },
        ],
      },
    ]);

    expect(decision?.targetId).toBe("slightly-lower-shared");
    expect(decision?.availableHelperIds).toEqual(["ally"]);
    expect(decision?.treatyBlockedHelperIds).toEqual([]);
    expect(decision?.offensiveCostMultiplier).toBeLessThan(1);
  });

  it("prefers a strong proven helper over a barely eligible ally", () => {
    const decision = selectCoalitionTarget([
      {
        targetId: "weak-help",
        basePriority: 7.6,
        ownCanReach: true,
        enemyActiveWars: 1,
        helpers: [
          {
            allyId: "uncertain",
            reliability: 0.46,
            reserveRatio: 0.51,
            canReach: true,
            treatyBlocked: false,
          },
        ],
      },
      {
        targetId: "strong-help",
        basePriority: 7,
        ownCanReach: true,
        enemyActiveWars: 1,
        helpers: [
          {
            allyId: "trusted",
            reliability: 0.92,
            reserveRatio: 0.9,
            canReach: true,
            treatyBlocked: false,
          },
        ],
      },
    ]);

    expect(decision?.targetId).toBe("strong-help");
    expect(decision?.availableHelperIds).toEqual(["trusted"]);
    expect(decision?.offensiveCostMultiplier).toBeLessThan(0.9);
  });

  it("does not turn a marginal ally into a large offensive discount", () => {
    const decision = selectCoalitionTarget([
      {
        targetId: "target",
        basePriority: 5,
        ownCanReach: true,
        enemyActiveWars: 0,
        helpers: [
          {
            allyId: "marginal",
            reliability: 0.45,
            reserveRatio: 0.5,
            canReach: true,
            treatyBlocked: false,
          },
        ],
      },
    ]);

    expect(decision?.offensiveCostMultiplier).toBeGreaterThan(0.94);
  });

  it("does not chase a distracted target without coalition support", () => {
    const decision = selectCoalitionTarget([
      {
        targetId: "random-dogpile",
        basePriority: 5,
        ownCanReach: true,
        enemyActiveWars: 3,
        helpers: [],
      },
      {
        targetId: "better-own-target",
        basePriority: 5.4,
        ownCanReach: true,
        enemyActiveWars: 0,
        helpers: [],
      },
    ]);

    expect(decision?.targetId).toBe("better-own-target");
  });

  it("does not count distant, exhausted, or treaty-blocked allies", () => {
    const decision = selectCoalitionTarget([
      {
        targetId: "target",
        basePriority: 5,
        ownCanReach: true,
        enemyActiveWars: 0,
        helpers: [
          {
            allyId: "distant",
            reliability: 0.9,
            reserveRatio: 0.9,
            canReach: false,
            treatyBlocked: false,
          },
          {
            allyId: "exhausted",
            reliability: 0.9,
            reserveRatio: 0.3,
            canReach: true,
            treatyBlocked: false,
          },
          {
            allyId: "blocked",
            reliability: 0.9,
            reserveRatio: 0.9,
            canReach: true,
            treatyBlocked: true,
          },
        ],
      },
    ]);

    expect(decision?.availableHelperIds).toEqual([]);
    expect(decision?.treatyBlockedHelperIds).toEqual(["blocked"]);
    expect(decision?.offensiveCostMultiplier).toBe(1);
  });
});

describe("coalition growth support", () => {
  const troopGrowthAt = (troops: number) =>
    (10 + troops ** 0.73 / 4) * (1 - troops / 1_000_000);
  const growthReady = {
    ownTroops: 900_000,
    ownMaxTroops: 1_000_000,
    reserveFloor: 0.48,
    activeNationWars: 0,
    incomingFronts: 0,
    allyTroops: 300_000,
    allyMaxTroops: 1_000_000,
    allyReliability: 0.75,
    allyIsNation: true,
    canDonate: true,
    allyHasGrowthRoute: true,
    troopGrowthAt,
  };

  it("supports ally growth only from surplus that improves home regeneration", () => {
    const decision = planCoalitionGrowthSupport(growthReady);

    expect(decision.donate).toBe(true);
    expect(decision.purpose).toBe("growth");
    expect(decision.amount).toBe(110_000);
    expect(decision.ownReserveAfter).toBe(0.79);
    expect(decision.growthRateAfter).toBeGreaterThan(decision.growthRateBefore);
  });

  it("supports an allied attack only when it suppresses enemy growth", () => {
    const decision = planCoalitionGrowthSupport({
      ...growthReady,
      allyHasGrowthRoute: false,
      allyCommittedTroops: 200_000,
      sharedEnemyTroops: 250_000,
      sharedEnemyMaxTroops: 1_000_000,
      sharedEnemyIsNation: true,
      allyCanPressureSharedEnemy: true,
      enemyGrowthAt: troopGrowthAt,
    });

    expect(decision.donate).toBe(true);
    expect(decision.purpose).toBe("pressure");
    expect(decision.amount).toBe(99_000);
    expect(decision.enemyGrowthRateAfter).toBeLessThan(
      decision.enemyGrowthRateBefore,
    );
    expect(decision.enemyGrowthSuppressionRatio).toBeGreaterThan(0.1);
    expect(decision.projectedEnemyReserveAfter).toBeLessThan(0.14);
    expect(decision.ownReserveAfter).toBeGreaterThan(0.79);
  });

  it("does not donate merely because attacking a full enemy looks dramatic", () => {
    const decision = planCoalitionGrowthSupport({
      ...growthReady,
      allyHasGrowthRoute: false,
      allyCommittedTroops: 50_000,
      sharedEnemyTroops: 900_000,
      sharedEnemyMaxTroops: 1_000_000,
      sharedEnemyIsNation: true,
      allyCanPressureSharedEnemy: true,
      enemyGrowthAt: troopGrowthAt,
    });

    expect(decision.donate).toBe(false);
    expect(decision.purpose).toBe("none");
  });

  it("keeps troops when the ally has no legal growth or pressure route", () => {
    expect(
      planCoalitionGrowthSupport({
        ...growthReady,
        allyHasGrowthRoute: false,
      }).donate,
    ).toBe(false);
  });

  it("keeps troops during a home war or for an unproven ally", () => {
    expect(
      planCoalitionGrowthSupport({
        ...growthReady,
        activeNationWars: 1,
      }).donate,
    ).toBe(false);
    expect(
      planCoalitionGrowthSupport({
        ...growthReady,
        allyReliability: 0.4,
      }).donate,
    ).toBe(false);
  });
});
