import { describe, expect, it } from "vitest";
import {
  MAX_TRADE_SHIP_LIGHTS,
  shouldEmitTradeShipLight,
} from "../../../src/client/render/gl/utils/TradeShipLightGrid";

describe("shouldEmitTradeShipLight", () => {
  it("merges ships occupying the same four-tile lighting cell", () => {
    const cells = new Set<number>();
    expect(shouldEmitTradeShipLight(cells, 8, 12, 1_000, 0)).toBe(true);
    expect(shouldEmitTradeShipLight(cells, 11, 15, 1_000, 1)).toBe(false);
    expect(shouldEmitTradeShipLight(cells, 12, 15, 1_000, 1)).toBe(true);
  });

  it("caps decorative trade lights so other units retain buffer capacity", () => {
    expect(
      shouldEmitTradeShipLight(
        new Set(),
        100,
        100,
        1_000,
        MAX_TRADE_SHIP_LIGHTS,
      ),
    ).toBe(false);
  });
});
