import { describe, expect, it } from "vitest";
import {
  allianceResponseWindowTicks,
  assessAllianceCooperation,
} from "../../src/client/ai/AllianceCooperationPolicy";

describe("AllianceCooperationPolicy", () => {
  it("trusts allies that answer requests and share front pressure", () => {
    const assessment = assessAllianceCooperation({
      requestsAnswered: 2,
      ignoredRequests: 0,
      sharedFrontSamples: 4,
      sharedFrontResponses: 4,
      unpromptedAidEvents: 1,
      allianceAgeRatio: 0.5,
    });

    expect(assessment.trusted).toBe(true);
    expect(assessment.shouldReplace).toBe(false);
    expect(assessment.reliability).toBeGreaterThan(0.8);
  });

  it("replaces an established ally only after repeated ignored requests", () => {
    const assessment = assessAllianceCooperation({
      requestsAnswered: 0,
      ignoredRequests: 2,
      sharedFrontSamples: 0,
      sharedFrontResponses: 0,
      unpromptedAidEvents: 0,
      allianceAgeRatio: 0.7,
    });

    expect(assessment.shouldReplace).toBe(true);
    expect(assessment.trusted).toBe(false);
  });

  it("keeps neutral confidence before enough evidence exists", () => {
    const assessment = assessAllianceCooperation({
      requestsAnswered: 0,
      ignoredRequests: 1,
      sharedFrontSamples: 0,
      sharedFrontResponses: 0,
      unpromptedAidEvents: 0,
      allianceAgeRatio: 0.1,
    });

    expect(assessment.shouldReplace).toBe(false);
    expect(assessment.confidence).toBeLessThan(0.5);
  });

  it("scales the response window from live game timing", () => {
    expect(
      allianceResponseWindowTicks({
        quickChatCooldownTicks: 30,
        allianceDurationTicks: 3_000,
      }),
    ).toBe(120);
    expect(
      allianceResponseWindowTicks({
        quickChatCooldownTicks: 50,
        allianceDurationTicks: 10_000,
      }),
    ).toBe(400);
  });
});
