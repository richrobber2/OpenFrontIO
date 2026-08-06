import { describe, expect, it } from "vitest";
import { chooseGoldBudget } from "../../src/client/ai/GoldBudgetPolicy";

const base = {
  gold: 1_000,
  incomePerMinute: 120,
  emergencyGoldFloor: 200,
  activeNationWars: 0,
  incomingStrikeRisk: 0.1,
  borderPressure: 0.2,
  uncoveredCriticalStructures: 0,
  usefulPortSites: 1,
  existingPorts: 1,
  existingCities: 2,
  existingDefensePosts: 1,
  existingSams: 0,
  existingSilos: 0,
  economyReturnScore: 8,
  navalNeedScore: 3,
  strategicWeaponValue: 2,
  infrastructureNeedScore: 4,
  allyAidUrgency: 1,
  recentLowValuePurchases: 0,
};

describe("chooseGoldBudget", () => {
  it("prioritizes anti-strike defense for exposed critical structures", () => {
    const decision = chooseGoldBudget({
      ...base,
      incomingStrikeRisk: 0.8,
      uncoveredCriticalStructures: 2,
    });
    expect(decision.category).toBe("emergency-defense");
    expect(decision.spendCap).toBeGreaterThan(0);
  });

  it("holds gold at the dynamic reserve floor", () => {
    const decision = chooseGoldBudget({
      ...base,
      gold: 250,
      incomePerMinute: 150,
      emergencyGoldFloor: 200,
      activeNationWars: 2,
    });
    expect(decision.category).toBe("hold");
    expect(decision.spendCap).toBe(0);
  });

  it("invests in economy when its return is strongest", () => {
    const decision = chooseGoldBudget(base);
    expect(decision.category).toBe("economy");
    expect(decision.spendCap).toBeLessThan(base.gold);
  });

  it("does not spam ports after useful naval coverage exists", () => {
    const decision = chooseGoldBudget({
      ...base,
      economyReturnScore: 2,
      navalNeedScore: 9,
      usefulPortSites: 0,
      existingPorts: 6,
      infrastructureNeedScore: 7,
    });
    expect(decision.category).not.toBe("navy");
  });

  it("penalizes repeated low-value infrastructure purchases", () => {
    const decision = chooseGoldBudget({
      ...base,
      economyReturnScore: 2,
      navalNeedScore: 1,
      strategicWeaponValue: 1,
      infrastructureNeedScore: 9,
      recentLowValuePurchases: 4,
    });
    expect(decision.category).not.toBe("infrastructure");
  });

  it("spends excess gold instead of hoarding forever", () => {
    const decision = chooseGoldBudget({
      ...base,
      gold: 5_000,
      economyReturnScore: 3,
      navalNeedScore: 2,
      strategicWeaponValue: 2,
      infrastructureNeedScore: 2,
    });
    expect(decision.category).not.toBe("hold");
    expect(decision.spendCap).toBeGreaterThan(0);
  });

  it("forces a useful sink when extreme surplus makes every option mediocre", () => {
    const decision = chooseGoldBudget({
      ...base,
      gold: 20_000,
      economyReturnScore: 0.5,
      navalNeedScore: 0,
      strategicWeaponValue: 0,
      infrastructureNeedScore: 1,
      allyAidUrgency: 0,
      recentLowValuePurchases: 3,
    });
    expect(decision.category).toBe("infrastructure");
    expect(decision.spendCap).toBeGreaterThanOrEqual(9_000);
    expect(decision.reason).toContain("extreme surplus");
  });

  it("deploys a larger share as the treasury grows far beyond reserve", () => {
    const ordinary = chooseGoldBudget(base);
    const rich = chooseGoldBudget({
      ...base,
      gold: 10_000,
    });
    expect(rich.spendCap / 10_000).toBeGreaterThan(
      ordinary.spendCap / base.gold,
    );
  });

  it("limits discretionary spending while strategic risk is high", () => {
    const safe = chooseGoldBudget(base);
    const risky = chooseGoldBudget({
      ...base,
      borderPressure: 0.55,
      activeNationWars: 2,
    });
    expect(risky.spendCap).toBeLessThanOrEqual(safe.spendCap);
  });
});
