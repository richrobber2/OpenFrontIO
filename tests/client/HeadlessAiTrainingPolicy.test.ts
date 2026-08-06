import { describe, expect, it } from "vitest";
import { shouldRecoverMissingMatch } from "../../scripts/headless-ai-training-policy.mjs";

describe("headless AI training recovery", () => {
  it("allows transient missing match states before recovery", () => {
    expect(shouldRecoverMissingMatch(3, 4)).toBe(false);
    expect(shouldRecoverMissingMatch(4, 4)).toBe(true);
  });

  it("does not allow a one-poll recovery threshold", () => {
    expect(shouldRecoverMissingMatch(1, 1)).toBe(false);
  });

  it("checks one million recovery states within a small hot-path budget", () => {
    const startedAt = performance.now();
    let recoveries = 0;
    for (let index = 0; index < 1_000_000; index += 1) {
      if (shouldRecoverMissingMatch(index % 8, 4)) recoveries += 1;
    }
    expect(recoveries).toBe(500_000);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
