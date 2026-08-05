import { describe, expect, it } from "vitest";
import {
  chooseBoatPosition,
  planCoastalRaid,
} from "../../src/client/ai/CoastalRaidPolicy";

describe("chooseBoatPosition", () => {
  it("retreats when naval support is below two-to-one", () => {
    expect(
      chooseBoatPosition({
        distanceFromFriendlyCoast: 80,
        distanceToUsefulCoastalTarget: 40,
        nearbyEnemyWarships: 2,
        nearbyFriendlyWarships: 3,
        carryingTroops: 10_000,
      }),
    ).toBe("retreat");
  });

  it("approaches a useful coastal target with two-to-one support", () => {
    expect(
      chooseBoatPosition({
        distanceFromFriendlyCoast: 70,
        distanceToUsefulCoastalTarget: 50,
        nearbyEnemyWarships: 2,
        nearbyFriendlyWarships: 4,
        carryingTroops: 8_000,
      }),
    ).toBe("approach-target");
  });

  it("shelters in port instead of accepting a one-to-one trade", () => {
    expect(
      chooseBoatPosition({
        distanceFromFriendlyCoast: 0,
        distanceToUsefulCoastalTarget: 30,
        nearbyEnemyWarships: 1,
        nearbyFriendlyWarships: 1,
        insideFriendlyPort: true,
        carryingTroops: 5_000,
      }),
    ).toBe("hold-in-port");
  });

  it("holds near the coast instead of wandering away", () => {
    expect(
      chooseBoatPosition({
        distanceFromFriendlyCoast: 35,
        distanceToUsefulCoastalTarget: null,
        nearbyEnemyWarships: 0,
        nearbyFriendlyWarships: 0,
        carryingTroops: 5_000,
      }),
    ).toBe("hold-near-coast");
  });
});

describe("planCoastalRaid", () => {
  it("sends only the troops needed to capture coastal buildings", () => {
    const plan = planCoastalRaid({
      availableFleetTroops: 50_000,
      reserveFleetTroops: 20_000,
      activeBoatRaids: 0,
      maxBoatRaids: 1,
      targets: [
        {
          id: "port-owner",
          coastalTroops: 8_000,
          coastalBuildingValue: 8,
          landingDefenseMultiplier: 1.25,
          distanceFromFriendlyCoast: 60,
          nearbyEnemyWarships: 1,
          nearbyFriendlyWarships: 2,
          wouldOpenNationWar: false,
        },
      ],
    });

    expect(plan.action).toBe("raid");
    expect(plan.targetID).toBe("port-owner");
    expect(plan.troops).toBe(11_200);
    expect(plan.troops).toBeLessThan(30_000);
  });

  it("rejects a one-to-one naval raid", () => {
    const plan = planCoastalRaid({
      availableFleetTroops: 50_000,
      reserveFleetTroops: 10_000,
      activeBoatRaids: 0,
      maxBoatRaids: 1,
      targets: [
        {
          id: "unsafe",
          coastalTroops: 2_000,
          coastalBuildingValue: 10,
          landingDefenseMultiplier: 1,
          distanceFromFriendlyCoast: 20,
          nearbyEnemyWarships: 1,
          nearbyFriendlyWarships: 1,
          wouldOpenNationWar: false,
        },
      ],
    });

    expect(plan.action).toBe("hold");
    expect(plan.reason).toContain("two-to-one");
  });

  it("allows a threatened raid to operate under friendly port protection", () => {
    const plan = planCoastalRaid({
      availableFleetTroops: 30_000,
      reserveFleetTroops: 10_000,
      activeBoatRaids: 0,
      maxBoatRaids: 1,
      targets: [
        {
          id: "protected",
          coastalTroops: 2_000,
          coastalBuildingValue: 9,
          landingDefenseMultiplier: 1,
          distanceFromFriendlyCoast: 15,
          nearbyEnemyWarships: 2,
          nearbyFriendlyWarships: 2,
          friendlyPortProtection: true,
          wouldOpenNationWar: false,
        },
      ],
    });

    expect(plan.action).toBe("raid");
    expect(plan.reason).toContain("port protection");
  });

  it("preserves the configured fleet reserve", () => {
    const plan = planCoastalRaid({
      availableFleetTroops: 12_000,
      reserveFleetTroops: 10_000,
      activeBoatRaids: 0,
      maxBoatRaids: 1,
      targets: [
        {
          id: "too-expensive",
          coastalTroops: 5_000,
          coastalBuildingValue: 8,
          landingDefenseMultiplier: 1.1,
          distanceFromFriendlyCoast: 30,
          nearbyEnemyWarships: 0,
          nearbyFriendlyWarships: 0,
          wouldOpenNationWar: false,
        },
      ],
    });

    expect(plan.action).toBe("hold");
  });
});
