import { describe, expect, it } from "vitest";
import {
  defensiveCounterBudget,
  estimateTicksUntilReserve,
  evaluateRaidRecallDefense,
  factoryOpportunityRetryTick,
  navalConstructionRetryTick,
  planAdaptivePlanningCadence,
  shouldLaunchDefensiveCounter,
  shouldPreFortifyInfrastructure,
  shouldPublishTelemetry,
  shouldTriggerEmergencyCity,
  shouldTriggerIdleGrowth,
} from "../../src/client/ai/DecisionTriggerPolicy";
import {
  ATTACK_RETREAT_DELAY_TICKS,
  ATTACK_RETREAT_MALUS_PERCENT,
} from "../../src/core/execution/AttackRetreatRules";

describe("DecisionTriggerPolicy", () => {
  const stableObservation = {
    incomingFronts: 0,
    outgoingFronts: 0,
    tribesAlive: 400,
    reserveRatio: 0.35,
    tiles: 20_000,
    strategicStructures: 4,
  };

  it("predicts when the reserve will be useful again", () => {
    expect(
      estimateTicksUntilReserve({
        troops: 350_000,
        maxTroops: 1_000_000,
        troopIncreasePerTick: 10_000,
        targetRatio: 0.82,
      }),
    ).toBe(47);
    expect(
      estimateTicksUntilReserve({
        troops: 900_000,
        maxTroops: 1_000_000,
        troopIncreasePerTick: 10_000,
        targetRatio: 0.82,
      }),
    ).toBe(0);
  });

  it("reuses a quiet plan while the reserve follows its forecast", () => {
    const planned = planAdaptivePlanningCadence({
      tick: 100,
      lastPlanningTick: 90,
      nextPlanningTick: 100,
      current: stableObservation,
      previous: stableObservation,
      ticksUntilUsefulReserve: 60,
    });

    expect(planned).toMatchObject({
      run: true,
      mode: "scheduled",
      intervalTicks: 10,
      forecastHorizonTicks: 60,
    });
    expect(
      planAdaptivePlanningCadence({
        tick: 101,
        lastPlanningTick: 100,
        nextPlanningTick: 110,
        current: stableObservation,
        previous: stableObservation,
        ticksUntilUsefulReserve: 59,
      }),
    ).toMatchObject({
      run: false,
      mode: "reuse",
      intervalTicks: 9,
      refreshOpponentForecasts: false,
    });
  });

  it("reacts immediately when a combat front changes", () => {
    expect(
      planAdaptivePlanningCadence({
        tick: 101,
        lastPlanningTick: 100,
        nextPlanningTick: 110,
        current: { ...stableObservation, incomingFronts: 1 },
        previous: stableObservation,
        ticksUntilUsefulReserve: 30,
      }),
    ).toMatchObject({
      run: true,
      mode: "reactive",
      intervalTicks: 2,
      refreshOpponentForecasts: true,
    });
  });

  it("reacts immediately when a tribe conquest completes", () => {
    expect(
      planAdaptivePlanningCadence({
        tick: 101,
        lastPlanningTick: 100,
        nextPlanningTick: 110,
        current: { ...stableObservation, tribesAlive: 399 },
        previous: stableObservation,
        ticksUntilUsefulReserve: 40,
      }),
    ).toMatchObject({
      run: true,
      mode: "reactive",
      intervalTicks: 2,
      refreshOpponentForecasts: true,
    });
  });

  it("reacts immediately to land loss or a reserve shock", () => {
    expect(
      planAdaptivePlanningCadence({
        tick: 101,
        lastPlanningTick: 100,
        nextPlanningTick: 110,
        current: {
          ...stableObservation,
          reserveRatio: 0.3,
          tiles: 19_999,
        },
        previous: stableObservation,
        ticksUntilUsefulReserve: 70,
      }),
    ).toMatchObject({ run: true, mode: "reactive" });
  });

  it("never launches two full planning passes on one simulation tick", () => {
    expect(
      planAdaptivePlanningCadence({
        tick: 100,
        lastPlanningTick: 100,
        nextPlanningTick: 101,
        current: { ...stableObservation, incomingFronts: 1 },
        previous: stableObservation,
        ticksUntilUsefulReserve: 20,
      }),
    ).toMatchObject({ run: false, mode: "reuse" });
  });

  it("keeps both the capacity floor and visible invasion covered", () => {
    const budget = defensiveCounterBudget({
      homeTroops: 2_582_484,
      maxTroops: 3_491_371,
      totalIncomingTroops: 1_600_000,
      selectedIncomingTroops: 1_450_000,
    });

    expect(budget.protectedTroops).toBeCloseTo(1_396_548.4);
    expect(budget.counterTroops).toBeCloseTo(1_185_935.6);
  });

  it("does not counter when the invasion already exceeds the home force", () => {
    expect(
      defensiveCounterBudget({
        homeTroops: 2_582_484,
        maxTroops: 3_491_371,
        totalIncomingTroops: 3_296_000,
        selectedIncomingTroops: 2_100_000,
      }).counterTroops,
    ).toBe(0);
  });

  it("cancels a small invasion below the normal offensive fraction", () => {
    expect(
      shouldLaunchDefensiveCounter({
        homeTroops: 1_296_390,
        selectedIncomingTroops: 92_503,
        counterTroops: 99_903,
      }),
    ).toBe(true);
  });

  it("does not waste a token squad that cannot cancel the selected front", () => {
    expect(
      shouldLaunchDefensiveCounter({
        homeTroops: 1_296_390,
        selectedIncomingTroops: 500_000,
        counterTroops: 40_000,
      }),
    ).toBe(false);
  });

  it("evaluates defensive counter triggers within a small hot-path budget", () => {
    const startedAt = performance.now();
    let launches = 0;
    for (let index = 0; index < 100_000; index += 1) {
      if (
        shouldLaunchDefensiveCounter({
          homeTroops: 1_000_000 + index,
          selectedIncomingTroops: 20_000 + (index % 50_000),
          counterTroops: 25_000 + (index % 100_000),
        })
      ) {
        launches += 1;
      }
    }
    expect(launches).toBeGreaterThan(0);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it("banks more capacity when several fronts attack at once", () => {
    const budget = defensiveCounterBudget({
      homeTroops: 2_582_484,
      maxTroops: 3_491_371,
      totalIncomingTroops: 1_600_000,
      selectedIncomingTroops: 1_450_000,
      activeIncomingFronts: 3,
    });

    expect(budget.protectedTroops).toBeCloseTo(2_094_822.6);
    expect(budget.counterTroops).toBeCloseTo(487_661.4);
  });

  it("recalls a raid before a third party crosses the home reserve floor", () => {
    const projection = evaluateRaidRecallDefense({
      homeTroops: 3_290_447,
      maxTroops: 7_778_108,
      raidTroops: 1_200_000,
      totalIncomingTroops: 3_308_890,
      thirdPartyIncomingTroops: 3_308_890,
      ownedTiles: 79_870,
      observedTileLossPerTick: 209,
      observedTroopLossPerTick: 4_000,
      returnDelayTicks: ATTACK_RETREAT_DELAY_TICKS,
      raidReturnSurvivalRatio: 1 - ATTACK_RETREAT_MALUS_PERCENT / 100,
      reserveFloorRatio: 0.4,
    });

    expect(projection.recall).toBe(true);
    expect(projection.thirdPartyPressure).toBe(true);
    expect(projection.projectedHomeTroops).toBeLessThan(
      projection.reserveFloorTroops,
    );
    expect(projection.returningTroops).toBe(900_000);
  });

  it("keeps a paid raid active through minor third-party pressure", () => {
    const projection = evaluateRaidRecallDefense({
      homeTroops: 600_000,
      maxTroops: 1_000_000,
      raidTroops: 100_000,
      totalIncomingTroops: 50_000,
      thirdPartyIncomingTroops: 50_000,
      ownedTiles: 20_000,
      observedTileLossPerTick: 0,
      observedTroopLossPerTick: 0,
      returnDelayTicks: ATTACK_RETREAT_DELAY_TICKS,
      raidReturnSurvivalRatio: 1 - ATTACK_RETREAT_MALUS_PERCENT / 100,
      reserveFloorRatio: 0.4,
    });

    expect(projection.recall).toBe(false);
    expect(projection.projectedHomeTroops).toBeGreaterThan(
      projection.reserveFloorTroops,
    );
  });

  it("recalls against the raid target when projected combat attrition breaks the floor", () => {
    const projection = evaluateRaidRecallDefense({
      homeTroops: 430_000,
      maxTroops: 1_000_000,
      raidTroops: 200_000,
      totalIncomingTroops: 500_000,
      thirdPartyIncomingTroops: 0,
      ownedTiles: 20_000,
      observedTileLossPerTick: 120,
      observedTroopLossPerTick: 5_000,
      returnDelayTicks: ATTACK_RETREAT_DELAY_TICKS,
      raidReturnSurvivalRatio: 1 - ATTACK_RETREAT_MALUS_PERCENT / 100,
      reserveFloorRatio: 0.4,
    });

    expect(projection.recall).toBe(true);
    expect(projection.thirdPartyPressure).toBe(false);
    expect(projection.projectedCaptureRatio).toBeGreaterThan(0.1);
  });

  it("keeps the recall decision invariant when a seed scales land and armies", () => {
    const evaluate = (scale: number) =>
      evaluateRaidRecallDefense({
        homeTroops: 600_000 * scale,
        maxTroops: 1_000_000 * scale,
        raidTroops: 150_000 * scale,
        totalIncomingTroops: 250_000 * scale,
        thirdPartyIncomingTroops: 250_000 * scale,
        ownedTiles: 20_000 * scale,
        observedTileLossPerTick: 100 * scale,
        observedTroopLossPerTick: 3_000 * scale,
        returnDelayTicks: ATTACK_RETREAT_DELAY_TICKS,
        raidReturnSurvivalRatio: 1 - ATTACK_RETREAT_MALUS_PERCENT / 100,
        reserveFloorRatio: 0.48,
      });

    const compactSeed = evaluate(1);
    const largeSeed = evaluate(10);
    expect(largeSeed.recall).toBe(compactSeed.recall);
    expect(largeSeed.projectedCaptureRatio).toBeCloseTo(
      compactSeed.projectedCaptureRatio,
    );
    expect(largeSeed.projectedHomeTroops).toBeCloseTo(
      compactSeed.projectedHomeTroops * 10,
    );
  });

  it("pre-fortifies valuable infrastructure before a plausible nation attack", () => {
    expect(
      shouldPreFortifyInfrastructure({
        borderingNationThreats: 2,
        strategicStructures: 5,
        reserveRatio: 0.7,
        reserveFloorRatio: 0.48,
        outgoingFronts: 0,
        defensePosts: 2,
        cities: 3,
      }),
    ).toBe(true);
  });

  it("does not pre-fortify while troops are already committed or regenerating", () => {
    const base = {
      borderingNationThreats: 1,
      strategicStructures: 3,
      reserveRatio: 0.7,
      reserveFloorRatio: 0.48,
      outgoingFronts: 0,
      defensePosts: 1,
      cities: 3,
    };

    expect(shouldPreFortifyInfrastructure({ ...base, outgoingFronts: 1 })).toBe(
      false,
    );
    expect(shouldPreFortifyInfrastructure({ ...base, reserveRatio: 0.4 })).toBe(
      false,
    );
  });

  it("does not let proactive posts consume the next city budget", () => {
    expect(
      shouldPreFortifyInfrastructure({
        borderingNationThreats: 3,
        strategicStructures: 5,
        reserveRatio: 0.9,
        reserveFloorRatio: 0.8,
        outgoingFronts: 0,
        defensePosts: 2,
        cities: 2,
      }),
    ).toBe(false);
  });

  it("triggers tribe growth as soon as an idle reserve is safely banked", () => {
    expect(
      shouldTriggerIdleGrowth({
        tick: 200,
        reserveRatio: 0.66,
        outgoingFronts: 0,
        hasTribeBorder: true,
      }),
    ).toBe(true);
  });

  it("does not interrupt the opening, an active front, or a low reserve", () => {
    expect(
      shouldTriggerIdleGrowth({
        tick: 40,
        reserveRatio: 0.9,
        outgoingFronts: 0,
        hasTribeBorder: true,
      }),
    ).toBe(false);
    expect(
      shouldTriggerIdleGrowth({
        tick: 200,
        reserveRatio: 0.9,
        outgoingFronts: 1,
        hasTribeBorder: true,
      }),
    ).toBe(false);
    expect(
      shouldTriggerIdleGrowth({
        tick: 200,
        reserveRatio: 0.65,
        outgoingFronts: 0,
        hasTribeBorder: true,
      }),
    ).toBe(false);
  });

  it("uses longer retry suppression for ports than warships", () => {
    expect(navalConstructionRetryTick(1_000, "warship")).toBe(1_100);
    expect(navalConstructionRetryTick(1_000, "port")).toBe(1_150);
    expect(navalConstructionRetryTick(1_000, "port", 1)).toBe(1_105);
    expect(navalConstructionRetryTick(1_000, "port", 0)).toBe(1_195);
  });

  it("backs off longer from an unaffordable factory than a queued build", () => {
    expect(factoryOpportunityRetryTick(1_000, "built")).toBe(1_100);
    expect(factoryOpportunityRetryTick(1_000, "unaffordable")).toBe(1_200);
    expect(factoryOpportunityRetryTick(1_000, "saturated")).toBe(1_400);
  });

  it("triggers a missing defensive city before passive collapse behavior", () => {
    expect(
      shouldTriggerEmergencyCity({
        tick: 500,
        nextAttemptTick: 400,
        incomingTroops: 80_000,
        maxTroops: 100_000,
        reserveRatio: 0.3,
        currentCities: 1,
        desiredCities: 4,
      }),
    ).toBe(true);
    expect(
      shouldTriggerEmergencyCity({
        tick: 500,
        nextAttemptTick: 400,
        incomingTroops: 80_000,
        maxTroops: 100_000,
        reserveRatio: 0.3,
        currentCities: 4,
        desiredCities: 4,
      }),
    ).toBe(false);
  });

  it("publishes telemetry once per bounded interval even while planning", () => {
    expect(shouldPublishTelemetry(100, 75)).toBe(true);
    expect(shouldPublishTelemetry(101, 100)).toBe(false);
    expect(shouldPublishTelemetry(100, 100)).toBe(false);
  });
});
