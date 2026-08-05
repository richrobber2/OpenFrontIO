import { describe, expect, it } from "vitest";
import { PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("projected troop growth", () => {
  it("matches the live rate and measures the regeneration gain from a safe donation", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("player", PlayerType.Human, "client_id", "player_id"),
    ]);
    const player = game.player("player_id");
    for (let y = 50; y < 100; y++) {
      for (let x = 50; x < 100; x++) player.conquer(game.ref(x, y));
    }
    const maxTroops = game.config().maxTroops(player);
    player.setTroops(maxTroops * 0.9);

    const liveRate = game.config().troopIncreaseRate(player);
    const projectedCurrent = game
      .config()
      .projectedTroopIncreaseRate(player, player.troops());
    const projectedAfterDonation = game
      .config()
      .projectedTroopIncreaseRate(player, maxTroops * 0.75);

    expect(projectedCurrent).toBe(liveRate);
    expect(projectedAfterDonation).toBeGreaterThan(liveRate);
  });
});
