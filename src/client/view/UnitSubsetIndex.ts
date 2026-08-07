import { UnitType } from "../../core/game/Game";
import {
  classifyUnitDeltasRust,
  UNIT_CLASS_ATTACK_RING,
  UNIT_CLASS_NUKE_ACTIVE,
  UNIT_CLASS_NUKE_TELEGRAPH,
  UNIT_CLASS_TRAIL,
  type UnitClassificationInput,
} from "../rust/OpenFrontWasmUnits";
import type { UnitState } from "../render/types";

function fallbackFlags(unitType: string, isActive: boolean): number {
  if (!isActive) return 0;
  switch (unitType) {
    case UnitType.TransportShip:
      return UNIT_CLASS_TRAIL | UNIT_CLASS_ATTACK_RING;
    case UnitType.AtomBomb:
    case UnitType.HydrogenBomb:
    case UnitType.MIRVWarhead:
      return (
        UNIT_CLASS_TRAIL |
        UNIT_CLASS_NUKE_ACTIVE |
        UNIT_CLASS_NUKE_TELEGRAPH
      );
    case UnitType.MIRV:
      return UNIT_CLASS_TRAIL | UNIT_CLASS_NUKE_ACTIVE;
    default:
      return 0;
  }
}

/**
 * Incremental indexes for the small unit subsets used by per-tick derivation.
 * UnitState objects are shared with GameView's master map, so moving units do
 * not require re-indexing: only creation/type/activity updates touch membership.
 */
export class UnitSubsetIndex {
  readonly trails = new Map<number, UnitState>();
  readonly nukeActive = new Map<number, UnitState>();
  readonly nukeTelegraphs = new Map<number, UnitState>();
  readonly attackRings = new Map<number, UnitState>();

  applyUpdates(
    updates: readonly UnitClassificationInput[],
    states: ReadonlyMap<number, UnitState>,
  ): void {
    const rust = classifyUnitDeltasRust(updates);
    const validRust = rust !== null && rust.length === updates.length * 3;

    for (let index = 0; index < updates.length; index++) {
      const update = updates[index]!;
      const state = states.get(update.id);
      const rustOffset = index * 3;
      const flags =
        validRust && rust![rustOffset] === (update.id >>> 0)
          ? rust![rustOffset + 2]!
          : fallbackFlags(update.unitType, update.isActive);
      this.sync(this.trails, update.id, state, flags & UNIT_CLASS_TRAIL);
      this.sync(
        this.nukeActive,
        update.id,
        state,
        flags & UNIT_CLASS_NUKE_ACTIVE,
      );
      this.sync(
        this.nukeTelegraphs,
        update.id,
        state,
        flags & UNIT_CLASS_NUKE_TELEGRAPH,
      );
      this.sync(
        this.attackRings,
        update.id,
        state,
        flags & UNIT_CLASS_ATTACK_RING,
      );
    }
  }

  trailIdsInto(out: number[]): void {
    out.length = 0;
    for (const id of this.trails.keys()) out.push(id);
  }

  private sync(
    target: Map<number, UnitState>,
    id: number,
    state: UnitState | undefined,
    member: number,
  ): void {
    if (member !== 0 && state?.isActive) {
      target.set(id, state);
    } else {
      target.delete(id);
    }
  }
}
