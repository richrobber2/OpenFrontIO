import { beforeEach, describe, expect, it } from "vitest";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { UseRealAttackLogic } from "../../util/TestConfig";

describe("real defense-post combat values", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("attacker", PlayerType.Nation, null, "attacker_id"),
        new PlayerInfo(
          "defender",
          PlayerType.Human,
          "defender_client",
          "defender_id",
        ),
      ],
      undefined,
      UseRealAttackLogic,
    );
    attacker = game.player("attacker_id");
    defender = game.player("defender_id");

    for (let y = 5; y < 25; y++) {
      for (let x = 5; x < 25; x++) attacker.conquer(game.ref(x, y));
    }
    for (let y = 50; y < 130; y++) {
      for (let x = 50; x < 130; x++) defender.conquer(game.ref(x, y));
    }
    attacker.setTroops(400_000);
    defender.setTroops(900_000);
  });

  it("measures the exact attrition and capture-resistance multipliers", () => {
    const target = game.ref(70, 70);
    const attackTroops = 250_000;
    const baseline = game
      .config()
      .attackLogic(game, attackTroops, attacker, defender, target);

    defender.buildUnit(UnitType.DefensePost, target, {});
    const fortified = game
      .config()
      .attackLogic(game, attackTroops, attacker, defender, target);

    expect(game.config().defensePostRange()).toBe(30);
    expect(
      fortified.attackerTroopLoss / baseline.attackerTroopLoss,
    ).toBeCloseTo(5);
    expect(fortified.tilesPerTickUsed / baseline.tilesPerTickUsed).toBeCloseTo(
      3,
    );
    expect(fortified.defenderTroopLoss).toBe(baseline.defenderTroopLoss);
  });

  it("only applies inside the radius and never stacks overlapping posts", () => {
    const defendedTarget = game.ref(70, 70);
    const distantTarget = game.ref(115, 115);
    const attackTroops = 250_000;
    const baseline = game
      .config()
      .attackLogic(game, attackTroops, attacker, defender, distantTarget);

    defender.buildUnit(UnitType.DefensePost, defendedTarget, {});
    defender.buildUnit(UnitType.DefensePost, game.ref(72, 70), {});
    const stacked = game
      .config()
      .attackLogic(game, attackTroops, attacker, defender, defendedTarget);
    const outsideRadius = game
      .config()
      .attackLogic(game, attackTroops, attacker, defender, distantTarget);

    expect(stacked.attackerTroopLoss / baseline.attackerTroopLoss).toBeCloseTo(
      5,
    );
    expect(stacked.tilesPerTickUsed / baseline.tilesPerTickUsed).toBeCloseTo(3);
    expect(outsideRadius).toEqual(baseline);
  });
});
