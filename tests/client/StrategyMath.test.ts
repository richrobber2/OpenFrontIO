import { describe, expect, it } from "vitest";
import {
  assessAttackCapacity,
  classifyLossCause,
  desiredBankedTroops,
  desiredCapacityEscapeCityCount,
  desiredDefensiveCityCount,
  desiredFactoryCount,
  desiredFleetTroopBank,
  desiredWarshipCount,
  estimateLandAttackTicks,
  estimateTradeRouteGold,
  estimateWildernessGrowth,
  evaluateSeedCohort,
  isStrategicallyTrapped,
  LossCause,
  minimumDefensePostDepth,
  nationFrontPolicy,
  planCapacityEscapeRaid,
  predictFutureOutcomes,
  railCityConnectionScore,
  railFactoryConnectionScore,
  scoreCityStackPlacement,
  scoreFactoryPlacement,
  scoreMutationOutcome,
  shouldAcceptAlliance,
  shouldBuildCapacityCity,
  shouldTradeLandForTime,
  tribeAttackCommitmentMultiplier,
} from "../../src/client/ai/StrategyMath";

describe("assessAttackCapacity", () => {
  it("allows an attack threshold that fits within troop capacity", () => {
    expect(
      assessAttackCapacity({
        maxTroops: 100_000,
        targetTroops: 50_000,
        requiredAdvantage: 1.8,
      }),
    ).toEqual({ requiredTroops: 90_000, reachable: true });
  });

  it("rejects a threshold the player can never save enough to reach", () => {
    expect(
      assessAttackCapacity({
        maxTroops: 100_000,
        targetTroops: 60_000,
        requiredAdvantage: 1.8,
      }),
    ).toEqual({ requiredTroops: 108_000, reachable: false });
  });

  it("treats the exact capacity boundary as reachable", () => {
    expect(
      assessAttackCapacity({
        maxTroops: 100_000,
        targetTroops: 50_000,
        requiredAdvantage: 2,
      }).reachable,
    ).toBe(true);
  });
});

describe("capacity escape planning", () => {
  it("uses a bounded raid after a prolonged full-bank deadlock", () => {
    const plan = planCapacityEscapeRaid({
      noGrowthTicks: 600,
      reserveRatio: 1,
      reserveFloor: 0.56,
      incomingFronts: 0,
      outgoingFronts: 0,
      requiredCapacityRatio: 1.6,
      terrainCost: 1.2,
    });

    expect(plan).not.toBeNull();
    expect(plan?.fraction).toBeGreaterThanOrEqual(0.06);
    expect(plan?.fraction).toBeLessThanOrEqual(0.12);
  });

  it("does not force growth through an unsafe or active front", () => {
    const baseline = {
      noGrowthTicks: 600,
      reserveRatio: 1,
      reserveFloor: 0.72,
      incomingFronts: 0,
      outgoingFronts: 0,
      requiredCapacityRatio: 1.6,
      terrainCost: 1.2,
    };
    expect(
      planCapacityEscapeRaid({ ...baseline, incomingFronts: 1 }),
    ).toBeNull();
    expect(
      planCapacityEscapeRaid({ ...baseline, reserveRatio: 0.78 }),
    ).toBeNull();
    expect(planCapacityEscapeRaid({ ...baseline, terrainCost: 3 })).toBeNull();
  });

  it("turns an unreachable troop requirement into capacity cities", () => {
    expect(
      desiredCapacityEscapeCityCount({
        baselineDesiredCities: 3,
        ownedCities: 3,
        noGrowthTicks: 1_200,
        reserveRatio: 0.98,
        incomingFronts: 0,
        maxTroops: 1_000_000,
        requiredTroops: 1_800_000,
        cityTroopIncrease: 250_000,
      }),
    ).toBeGreaterThan(3);
    expect(
      desiredCapacityEscapeCityCount({
        baselineDesiredCities: 3,
        ownedCities: 3,
        noGrowthTicks: 1_200,
        reserveRatio: 0.98,
        incomingFronts: 1,
        maxTroops: 1_000_000,
        requiredTroops: 1_800_000,
        cityTroopIncrease: 250_000,
      }),
    ).toBe(3);
  });
});

const baseline = {
  attackerTroops: 100_000,
  defenderTroops: 50_000,
  fraction: 0.2,
  borderWidth: 2,
  combatCost: 1,
  tilesToTake: 300,
};

describe("estimateLandAttackTicks", () => {
  it("mirrors the capped troop-ratio progress budget", () => {
    expect(estimateLandAttackTicks(baseline)).toBe(100);
  });

  it("rewards wider borders", () => {
    expect(
      estimateLandAttackTicks({ ...baseline, borderWidth: 4 }),
    ).toBeLessThan(estimateLandAttackTicks(baseline));
  });

  it("predicts slower capture while more troops remain home", () => {
    expect(
      estimateLandAttackTicks({ ...baseline, defenderTroops: 100_000 }),
    ).toBeGreaterThan(
      estimateLandAttackTicks({ ...baseline, defenderTroops: 10_000 }),
    );
  });

  it("prices defense-post and difficult-terrain costs", () => {
    expect(estimateLandAttackTicks({ ...baseline, combatCost: 6 })).toBe(600);
  });

  it("allows a feasible limited land grab when full conquest is too slow", () => {
    const fullConquest = estimateLandAttackTicks({
      ...baseline,
      combatCost: 2,
      tilesToTake: 2_000,
    });
    const landGrab = estimateLandAttackTicks({
      ...baseline,
      combatCost: 2,
      tilesToTake: 20,
    });
    expect(fullConquest).toBeGreaterThan(600);
    expect(landGrab).toBeLessThan(100);
  });
});

describe("shouldAcceptAlliance", () => {
  const usefulRequest = {
    availableAllianceSlots: 1,
    activeConflict: false,
    requestorIsTribe: false,
    preservesBestExpansionRoute: true,
    closesDangerousFront: true,
    usefulRemotePartner: false,
    crowdedBorders: false,
  };

  it("accepts a request that closes a dangerous front", () => {
    expect(shouldAcceptAlliance(usefulRequest)).toBe(true);
  });

  it("rejects requests while fighting the requestor", () => {
    expect(
      shouldAcceptAlliance({ ...usefulRequest, activeConflict: true }),
    ).toBe(false);
  });

  it("protects alliance slots and valuable tribe expansion", () => {
    expect(
      shouldAcceptAlliance({ ...usefulRequest, availableAllianceSlots: 0 }),
    ).toBe(false);
    expect(
      shouldAcceptAlliance({ ...usefulRequest, requestorIsTribe: true }),
    ).toBe(false);
  });
});

describe("infrastructure strategy", () => {
  it("keeps one factory until the city economy can support late expansion", () => {
    expect(
      desiredFactoryCount({
        economicStops: 8,
        ownedCities: 5,
        ownedTiles: 5_000,
        gold: 10_000_000,
        reserveRatio: 0.9,
      }),
    ).toBe(1);
    expect(
      desiredFactoryCount({
        economicStops: 8,
        ownedCities: 6,
        ownedTiles: 6_000,
        gold: 2_000_000,
        reserveRatio: 0.55,
      }),
    ).toBe(2);
  });

  it("requires a mature, wealthy city network before a third factory", () => {
    expect(
      desiredFactoryCount({
        economicStops: 12,
        ownedCities: 9,
        ownedTiles: 12_000,
        gold: 5_000_000,
        reserveRatio: 0.7,
      }),
    ).toBe(2);
    expect(
      desiredFactoryCount({
        economicStops: 12,
        ownedCities: 10,
        ownedTiles: 12_000,
        gold: 5_000_000,
        reserveRatio: 0.65,
      }),
    ).toBe(3);
  });

  it("requires two owned cities before starting the first factory", () => {
    expect(
      desiredFactoryCount({
        economicStops: 4,
        ownedCities: 1,
        ownedTiles: 8_000,
        gold: 5_000_000,
        reserveRatio: 0.8,
      }),
    ).toBe(0);
  });

  it("prioritizes cities only when both land and sea expansion are blocked", () => {
    expect(
      isStrategicallyTrapped({
        hasNeutralLand: false,
        hasSeaAccess: false,
        hostileBorders: 2,
      }),
    ).toBe(true);
    expect(
      isStrategicallyTrapped({
        hasNeutralLand: true,
        hasSeaAccess: false,
        hostileBorders: 2,
      }),
    ).toBe(false);
  });

  it("requires deeper post placement unless a land buffer can be created", () => {
    expect(minimumDefensePostDepth(false, 30)).toBe(21);
    expect(minimumDefensePostDepth(true, 30)).toBe(10);
  });

  it("prefers cities that bridge usable rail stations near a factory", () => {
    expect(
      railCityConnectionScore({
        hasFactoryInRange: true,
        stationDistancesSquared: [20 ** 2, 70 ** 2, 130 ** 2],
        minimumRange: 15,
        maximumRange: 110,
      }),
    ).toBe(2);
    expect(
      railCityConnectionScore({
        hasFactoryInRange: false,
        stationDistancesSquared: [20 ** 2, 70 ** 2],
        minimumRange: 15,
        maximumRange: 110,
      }),
    ).toBe(0);
  });

  it("values factories that connect multiple cities or ports", () => {
    expect(
      railFactoryConnectionScore({
        structureDistancesSquared: [20 ** 2, 80 ** 2, 130 ** 2],
        minimumRange: 15,
        maximumRange: 110,
      }),
    ).toBe(2);
  });

  it("strongly prefers a legal tight city stack over a scattered site", () => {
    const stacked = scoreCityStackPlacement({
      cityDistancesSquared: [17 ** 2, 28 ** 2],
      structureMinDistance: 15,
    });
    const scattered = scoreCityStackPlacement({
      cityDistancesSquared: [80 ** 2],
      structureMinDistance: 15,
    });

    expect(stacked.stacked).toBe(true);
    expect(stacked.nearbyCities).toBe(2);
    expect(stacked.score).toBeGreaterThan(100);
    expect(scattered).toMatchObject({ stacked: false, score: 0 });
  });

  it("ranks a safe straight factory network above an isolated bent site", () => {
    const connected = scoreFactoryPlacement({
      ownCities: 3,
      ownPorts: 1,
      externalCities: 1,
      externalPorts: 1,
      factoryCorridorConnections: 1,
      overlappingRailroads: 1,
      ghostPathLengths: [35, 42],
      railBends: 1,
      depth: 16,
      safestDepth: 18,
      nearestFactoryDistance: 75,
      minimumRange: 15,
      maximumRange: 110,
    });
    const poor = scoreFactoryPlacement({
      ownCities: 1,
      ownPorts: 0,
      externalCities: 0,
      externalPorts: 0,
      factoryCorridorConnections: 1,
      overlappingRailroads: 0,
      ghostPathLengths: [100],
      railBends: 9,
      depth: 3,
      safestDepth: 18,
      nearestFactoryDistance: 25,
      minimumRange: 15,
      maximumRange: 110,
    });

    expect(connected.productiveStops).toBe(6);
    expect(connected.railEfficiency).toBeGreaterThan(poor.railEfficiency);
    expect(connected.score).toBeGreaterThan(poor.score);
  });

  it("prices long trade routes above short-range routes", () => {
    expect(estimateTradeRouteGold(450)).toBeGreaterThan(
      estimateTradeRouteGold(150),
    );
  });

  it("delays isolated cities while free land can grow the economy", () => {
    expect(
      shouldBuildCapacityCity({
        reserveRatio: 0.4,
        hasNeutralLand: true,
        trapped: false,
        railConnections: 0,
      }),
    ).toBe(false);
    expect(
      shouldBuildCapacityCity({
        reserveRatio: 0.4,
        hasNeutralLand: true,
        trapped: false,
        railConnections: 2,
      }),
    ).toBe(true);
  });

  it("raises the city target as hostile fronts and incoming attacks multiply", () => {
    const quietTarget = desiredDefensiveCityCount({
      enemyFronts: 1,
      activeWars: 0,
      incomingFronts: 0,
      ownedCities: 1,
      ownedTiles: 400,
      reserveRatio: 0.8,
    });
    const pressuredTarget = desiredDefensiveCityCount({
      enemyFronts: 3,
      activeWars: 2,
      incomingFronts: 2,
      ownedCities: 1,
      ownedTiles: 400,
      reserveRatio: 0.4,
    });
    expect(quietTarget).toBe(1);
    expect(pressuredTarget).toBeGreaterThan(quietTarget);
  });

  it("adds roughly one capacity city per thousand owned tiles", () => {
    expect(
      desiredDefensiveCityCount({
        enemyFronts: 0,
        activeWars: 0,
        incomingFronts: 0,
        ownedCities: 1,
        ownedTiles: 5_000,
        reserveRatio: 0.8,
      }),
    ).toBe(4);
  });

  it("scales stacked city capacity beyond eight under overwhelming pressure", () => {
    expect(
      desiredDefensiveCityCount({
        enemyFronts: 3,
        activeWars: 2,
        incomingFronts: 3,
        ownedCities: 8,
        ownedTiles: 10_000,
        reserveRatio: 0.2,
        incomingTroopRatio: 2.5,
      }),
    ).toBe(16);
  });

  it("keeps nation banking attainable while tribes need less reserve", () => {
    const nationBank = desiredBankedTroops({
      maxTroops: 100_000,
      enemyTroops: 100_000,
      enemyFronts: 2,
      reserveFloor: 0.48,
      isTribe: false,
    });
    const tribeBank = desiredBankedTroops({
      maxTroops: 100_000,
      enemyTroops: 100_000,
      enemyFronts: 2,
      reserveFloor: 0.48,
      isTribe: true,
    });
    expect(nationBank).toBe(92_000);
    expect(tribeBank).toBe(50_000);
    expect(nationBank).toBeLessThanOrEqual(100_000);
    expect(nationBank).toBeGreaterThan(tribeBank);
  });

  it("banks more home troops as hostile nation fronts multiply", () => {
    const oneFront = desiredBankedTroops({
      maxTroops: 200_000,
      enemyTroops: 100_000,
      enemyFronts: 1,
      reserveFloor: 0.48,
      isTribe: false,
    });
    const threeFronts = desiredBankedTroops({
      maxTroops: 200_000,
      enemyTroops: 100_000,
      enemyFronts: 3,
      reserveFloor: 0.48,
      isTribe: false,
    });
    expect(threeFronts).toBeGreaterThan(oneFront);
    expect(threeFronts).toBeLessThan(200_000);
  });

  it("shrinks the transport troop bank when hostile warships lack escorts", () => {
    expect(
      desiredFleetTroopBank({
        maxTroops: 100_000,
        nearbyHostileWarships: 3,
        ownWarships: 1,
        hasTradeTarget: true,
      }),
    ).toBe(12_000);
    expect(
      desiredFleetTroopBank({
        maxTroops: 100_000,
        nearbyHostileWarships: 0,
        ownWarships: 2,
        hasTradeTarget: false,
      }),
    ).toBe(28_000);
  });

  it("produces multiple portable predictions for the same action", () => {
    const predictions = predictFutureOutcomes({
      action: "attack",
      troops: 80_000,
      maxTroops: 120_000,
      tiles: 500,
      enemyTroops: 40_000,
      horizon: 30,
    });
    expect(predictions).toHaveLength(5);
    expect(
      predictions.every((prediction) => prediction.action === "attack"),
    ).toBe(true);
    expect(predictions[0].expectedTroops).not.toBe(
      predictions[4].expectedTroops,
    );
  });

  it("recognizes early wilderness as a troop-capacity investment", () => {
    const estimate = estimateWildernessGrowth({
      currentTiles: 1,
      projectedTiles: 40,
      currentMaxTroops: 75_000,
      reserveRatio: 0.35,
    });
    expect(estimate.capacityGain).toBeGreaterThan(500);
    expect(estimate.worthwhile).toBe(true);
  });

  it("uses a faster tribe commitment at a 2x troop advantage", () => {
    expect(tribeAttackCommitmentMultiplier(20_000, 10_000)).toBe(2);
    expect(tribeAttackCommitmentMultiplier(15_000, 10_000)).toBe(1.08);
  });

  it("trades outer land for time while the reserve is low", () => {
    expect(
      shouldTradeLandForTime({
        reserveRatio: 0.42,
        incomingTroopRatio: 0.5,
        activeIncomingFronts: 1,
      }),
    ).toBe(true);
    expect(
      shouldTradeLandForTime({
        reserveRatio: 0.42,
        incomingTroopRatio: 0.9,
        activeIncomingFronts: 1,
      }),
    ).toBe(false);
  });
});

describe("nationFrontPolicy", () => {
  it("raises reserves and required advantage as nation fronts multiply", () => {
    const oneFront = nationFrontPolicy({
      nationFronts: 1,
      activeNationWars: 0,
    });
    const crowded = nationFrontPolicy({ nationFronts: 4, activeNationWars: 2 });
    expect(crowded.reserveFloor).toBeGreaterThan(oneFront.reserveFloor);
    expect(crowded.advantageMultiplier).toBeGreaterThan(
      oneFront.advantageMultiplier,
    );
    expect(crowded.maxNationOffensives).toBe(1);
    expect(crowded.desiredAlliances).toBe(2);
  });

  it("allows one deliberate offensive across several quiet borders", () => {
    const quiet = nationFrontPolicy({ nationFronts: 4, activeNationWars: 0 });
    expect(quiet.maxNationOffensives).toBe(1);
    expect(quiet.reserveFloor).toBeGreaterThan(0.6);
    expect(quiet.advantageMultiplier).toBeGreaterThan(1.5);
  });
});

describe("desiredWarshipCount", () => {
  it("scales defense with nearby warships and transport pressure", () => {
    expect(
      desiredWarshipCount({
        nearbyHostileWarships: 2,
        nearbyHostileTransports: 3,
        vulnerableTradeShips: 0,
        navalBias: 0,
      }),
    ).toBe(4);
  });

  it("maintains a small economic-raiding fleet when trade targets exist", () => {
    expect(
      desiredWarshipCount({
        nearbyHostileWarships: 0,
        nearbyHostileTransports: 0,
        vulnerableTradeShips: 5,
        navalBias: 1.2,
      }),
    ).toBe(2);
  });

  it("does not build a navy without a defensive or economic target", () => {
    expect(
      desiredWarshipCount({
        nearbyHostileWarships: 0,
        nearbyHostileTransports: 0,
        vulnerableTradeShips: 0,
        navalBias: 2,
      }),
    ).toBe(0);
  });
});

describe("evaluateSeedCohort", () => {
  it("keeps a candidate active until every seed is scored", () => {
    expect(
      evaluateSeedCohort({
        scoreTotal: 900,
        completedSeeds: 2,
        nextScore: 300,
        requiredSeeds: 4,
        baselineScore: 500,
        firstGeneration: false,
      }),
    ).toEqual({
      scoreTotal: 1_200,
      completedSeeds: 3,
      complete: false,
      averageScore: 400,
      accepted: null,
    });
  });

  it("accepts or rejects using the completed cohort average", () => {
    expect(
      evaluateSeedCohort({
        scoreTotal: 1_650,
        completedSeeds: 3,
        nextScore: 550,
        requiredSeeds: 4,
        baselineScore: 500,
        firstGeneration: false,
      }),
    ).toMatchObject({ complete: true, averageScore: 550, accepted: true });
    expect(
      evaluateSeedCohort({
        scoreTotal: 1_200,
        completedSeeds: 3,
        nextScore: 200,
        requiredSeeds: 4,
        baselineScore: 500,
        firstGeneration: false,
      }).accepted,
    ).toBe(false);
  });
});

describe("classifyLossCause", () => {
  const stable = {
    elapsedTicks: 1_000,
    thirdPartyPressureTicks: 0,
    maxIncomingRatio: 0.2,
    lowReserveTicks: 0,
    maxCommittedRatio: 0.3,
    longestStallTicks: 0,
    longestNoGrowthTicks: 0,
    noGainTicks: 20,
    peakTiles: 5_000,
    peakCities: 2,
  };

  it("identifies third-party exploitation before generic overextension", () => {
    expect(
      classifyLossCause({
        ...stable,
        thirdPartyPressureTicks: 200,
        maxIncomingRatio: 0.8,
        lowReserveTicks: 300,
        maxCommittedRatio: 0.8,
      }),
    ).toBe(LossCause.ThirdParty);
  });

  it("does not let a late invasion hide prolonged containment", () => {
    expect(
      classifyLossCause({
        ...stable,
        elapsedTicks: 2_000,
        longestNoGrowthTicks: 900,
        thirdPartyPressureTicks: 400,
        maxIncomingRatio: 1.2,
        peakTiles: 12_000,
      }),
    ).toBe(LossCause.Containment);
  });

  it("distinguishes overextension, stalled attacks, and containment", () => {
    expect(
      classifyLossCause({
        ...stable,
        lowReserveTicks: 300,
        maxCommittedRatio: 0.7,
      }),
    ).toBe(LossCause.Overextension);
    expect(classifyLossCause({ ...stable, longestStallTicks: 220 })).toBe(
      LossCause.StalledOffense,
    );
    expect(
      classifyLossCause({ ...stable, noGainTicks: 300, peakTiles: 1_500 }),
    ).toBe(LossCause.Containment);
  });
});

describe("scoreMutationOutcome", () => {
  const passive = {
    won: false,
    alive: false,
    playerCount: 400,
    finishingRank: 80,
    raidSuccessRate: 0.9,
    retaliationRate: 0.3,
    transportLossRate: 0.1,
    predictionQuality: 0.8,
    startingTiles: 50,
    peakTiles: 10_000,
    totalLandTiles: 1_000_000,
    elapsedTicks: 10_000,
    noGrowthTicks: 3_000,
    longestNoGrowthTicks: 4_000,
    peakCities: 5,
    peakFactories: 0,
  };

  it("rewards durable territorial and economic growth over passive survival", () => {
    const growing = scoreMutationOutcome({
      ...passive,
      finishingRank: 100,
      peakTiles: 80_000,
      noGrowthTicks: 200,
      longestNoGrowthTicks: 500,
      peakCities: 10,
      peakFactories: 2,
    });
    expect(growing).toBeGreaterThan(scoreMutationOutcome(passive));
  });

  it("makes winning materially better than merely surviving deep", () => {
    const winning = scoreMutationOutcome({
      ...passive,
      won: true,
      alive: true,
      finishingRank: 1,
      noGrowthTicks: 0,
      longestNoGrowthTicks: 200,
    });
    expect(winning - scoreMutationOutcome(passive)).toBeGreaterThan(1_000);
  });
});
