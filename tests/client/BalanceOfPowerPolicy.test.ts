import { describe, expect, it } from "vitest";
import { chooseBalanceOfPowerAction } from "../../src/client/ai/BalanceOfPowerPolicy";

const base = {
  ownReserveRatio: 0.8,
  ownActiveWars: 0,
  ownBorderExposure: 0.2,
  diplomaticExposureRisk: 0.15,
  candidates: [
    {
      id: "alpha",
      powerRatioToSelf: 0.78,
      reserveRatio: 0.7,
      activeWars: 0,
      growthMomentum: 0.6,
      hostilityToSelf: 0.5,
      nuclearCapability: false,
      mirvProgress: 0.1,
    },
    {
      id: "beta",
      powerRatioToSelf: 0.72,
      reserveRatio: 0.65,
      activeWars: 0,
      growthMomentum: 0.5,
      hostilityToSelf: 0.4,
      nuclearCapability: false,
      mirvProgress: 0.1,
    },
  ],
};

describe("chooseBalanceOfPowerAction", () => {
  it("encourages conflict between comparable rivals", () => {
    const decision = chooseBalanceOfPowerAction(base);
    expect(decision.action).toBe("encourage-conflict");
    expect(decision.commitmentCap).toBeGreaterThan(0);
  });

  it("supports the weaker side when one rival is becoming dominant", () => {
    const decision = chooseBalanceOfPowerAction({
      ...base,
      candidates: [
        { ...base.candidates[0], powerRatioToSelf: 1.05 },
        { ...base.candidates[1], powerRatioToSelf: 0.62 },
      ],
    });
    expect(decision.action).toBe("support-weaker-side");
    expect(decision.supportNationID).toBe("beta");
  });

  it("does not meddle while own security is weak", () => {
    const decision = chooseBalanceOfPowerAction({
      ...base,
      ownReserveRatio: 0.45,
    });
    expect(decision.action).toBe("hold");
  });

  it("avoids using near-MIRV nations as conflict pieces", () => {
    const decision = chooseBalanceOfPowerAction({
      ...base,
      candidates: base.candidates.map((candidate) => ({
        ...candidate,
        mirvProgress: 0.9,
      })),
    });
    expect(decision.action).toBe("hold");
  });

  it("limits indirect commitment as diplomatic exposure rises", () => {
    const subtle = chooseBalanceOfPowerAction(base);
    const exposed = chooseBalanceOfPowerAction({
      ...base,
      diplomaticExposureRisk: 0.4,
    });
    expect(exposed.commitmentCap).toBeLessThan(subtle.commitmentCap);
  });
});
