import { describe, expect, it } from "vitest";
import type { GameView } from "../../../src/client/view/GameView";
import type { PlayerView } from "../../../src/client/view/PlayerView";
import { UnitView } from "../../../src/client/view/UnitView";
import { UnitType } from "../../../src/core/game/Game";
import { makeUnitUpdate } from "../../util/viewStubs";

function playerStub(smallID: number): PlayerView {
  return {
    smallID: () => smallID,
    isPlayer: () => true,
  } as unknown as PlayerView;
}

function gameStub({
  wireOwner,
  territoryOwner,
  hasOwner = true,
}: {
  wireOwner: PlayerView;
  territoryOwner: PlayerView;
  hasOwner?: boolean;
}): GameView {
  return {
    ticks: () => 10,
    hasOwner: () => hasOwner,
    owner: () => territoryOwner,
    playerBySmallID: () => wireOwner,
  } as unknown as GameView;
}

describe("UnitView captured-structure ownership", () => {
  it("uses current territory ownership for a captured structure", () => {
    const formerOwner = playerStub(1);
    const captor = playerStub(2);
    const unit = new UnitView(
      gameStub({ wireOwner: formerOwner, territoryOwner: captor }),
      makeUnitUpdate({
        unitType: UnitType.City,
        ownerID: formerOwner.smallID(),
        pos: 25,
      }),
    );

    expect(unit.owner()).toBe(captor);
    expect(unit.state.ownerID).toBe(captor.smallID());
  });

  it("updates owner state immediately when captured territory changes", () => {
    const formerOwner = playerStub(1);
    const captor = playerStub(2);
    let territoryOwner = formerOwner;
    const game = {
      ticks: () => 10,
      hasOwner: () => true,
      owner: () => territoryOwner,
      playerBySmallID: (smallID: number) =>
        smallID === formerOwner.smallID() ? formerOwner : captor,
    } as unknown as GameView;
    const unit = new UnitView(
      game,
      makeUnitUpdate({
        unitType: UnitType.MissileSilo,
        ownerID: formerOwner.smallID(),
        pos: 25,
      }),
    );

    expect(unit.state.ownerID).toBe(formerOwner.smallID());
    territoryOwner = captor;
    expect(unit.state.ownerID).toBe(captor.smallID());
    expect(unit.owner()).toBe(captor);
  });

  it("keeps mobile-unit ownership from the unit update", () => {
    const fleetOwner = playerStub(1);
    const territoryOwner = playerStub(2);
    const unit = new UnitView(
      gameStub({ wireOwner: fleetOwner, territoryOwner }),
      makeUnitUpdate({
        unitType: UnitType.Warship,
        ownerID: fleetOwner.smallID(),
        pos: 25,
      }),
    );

    expect(unit.owner()).toBe(fleetOwner);
    expect(unit.state.ownerID).toBe(fleetOwner.smallID());
  });

  it("falls back to the unit update when a structure tile is unowned", () => {
    const wireOwner = playerStub(1);
    const territoryOwner = playerStub(2);
    const unit = new UnitView(
      gameStub({ wireOwner, territoryOwner, hasOwner: false }),
      makeUnitUpdate({
        unitType: UnitType.Factory,
        ownerID: wireOwner.smallID(),
        pos: 25,
      }),
    );

    expect(unit.owner()).toBe(wireOwner);
    expect(unit.state.ownerID).toBe(wireOwner.smallID());
  });
});
