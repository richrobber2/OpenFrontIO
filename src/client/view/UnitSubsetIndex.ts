import { UnitType } from "../../core/game/Game";
import { registerUnitRenderSubsets } from "../render/frame/UnitSubsetRegistry";
import type { UnitState } from "../render/types";
import {
  classifyUnitDeltasRust,
  type RustStructureRenderDelta,
  type StructureRenderInput,
  UNIT_CLASS_ATTACK_RING,
  UNIT_CLASS_MOBILE,
  UNIT_CLASS_NUKE_ACTIVE,
  UNIT_CLASS_NUKE_TELEGRAPH,
  UNIT_CLASS_STRUCTURE,
  UNIT_CLASS_TRAIL,
  updateStructureRenderDeltasRust,
} from "../rust/OpenFrontWasmUnits";

const STRUCTURE_TYPES = new Set<string>([
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
]);

const MOBILE_TYPES = new Set<string>([
  UnitType.TransportShip,
  UnitType.TradeShip,
  UnitType.Warship,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.SAMMissile,
  UnitType.Shell,
  UnitType.MIRVWarhead,
  UnitType.Train,
]);

function fallbackFlags(unitType: string, isActive: boolean): number {
  if (!isActive) return 0;

  let flags = 0;
  if (STRUCTURE_TYPES.has(unitType)) {
    flags |= UNIT_CLASS_STRUCTURE;
  } else if (MOBILE_TYPES.has(unitType)) {
    flags |= UNIT_CLASS_MOBILE;
  }

  switch (unitType) {
    case UnitType.TransportShip:
      return flags | UNIT_CLASS_TRAIL | UNIT_CLASS_ATTACK_RING;
    case UnitType.AtomBomb:
    case UnitType.HydrogenBomb:
    case UnitType.MIRVWarhead:
      return (
        flags |
        UNIT_CLASS_TRAIL |
        UNIT_CLASS_NUKE_ACTIVE |
        UNIT_CLASS_NUKE_TELEGRAPH
      );
    case UnitType.MIRV:
      return flags | UNIT_CLASS_TRAIL | UNIT_CLASS_NUKE_ACTIVE;
    default:
      return flags;
  }
}

/**
 * Incremental indexes for unit subsets used by per-tick derivation and render
 * passes. UnitState objects are shared with GameView's master map, so moving
 * units do not require copying state: only unit deltas update membership.
 *
 * The same changed-unit stream also feeds Rust's persistent structure render
 * table. After its one-time seed, structure rendering receives only changed
 * packed slots rather than walking and repacking every building.
 */
export class UnitSubsetIndex {
  readonly mobile = new Map<number, UnitState>();
  readonly structures = new Map<number, UnitState>();
  readonly warships = new Map<number, UnitState>();
  readonly progressStructures = new Map<number, UnitState>();
  readonly trails = new Map<number, UnitState>();
  readonly nukeActive = new Map<number, UnitState>();
  readonly nukeTelegraphs = new Map<number, UnitState>();
  readonly attackRings = new Map<number, UnitState>();

  /** Advances whenever a structure receives a delta, including removal. */
  structureRevision = 0;
  /** Latest copied dirty slot range produced by the Rust structure table. */
  structureRenderDelta: RustStructureRenderDelta | null = null;

  private rustStructureInitialized = false;
  private readonly structureDeltaScratch: StructureRenderInput[] = [];

  constructor(private readonly mapWidth: number) {}

  applyUpdates(
    updates: readonly StructureRenderInput[],
    states: ReadonlyMap<number, UnitState>,
  ): void {
    // The master state map is long-lived. Registering each call is cheap and
    // also guarantees the renderer can resolve subsets before its first upload.
    registerUnitRenderSubsets(states, this);

    const rust = classifyUnitDeltasRust(updates);
    const validRust = rust !== null && rust.length === updates.length * 3;
    const structureDeltas = this.structureDeltaScratch;
    structureDeltas.length = 0;

    for (let index = 0; index < updates.length; index++) {
      const update = updates[index]!;
      const state = states.get(update.id);
      const rustOffset = index * 3;
      const flags =
        validRust && rust![rustOffset] === (update.id >>> 0)
          ? rust![rustOffset + 2]!
          : fallbackFlags(update.unitType, update.isActive);

      const wasStructure = this.structures.has(update.id);
      const isStructure = (flags & UNIT_CLASS_STRUCTURE) !== 0;

      this.sync(this.mobile, update.id, state, flags & UNIT_CLASS_MOBILE);
      this.sync(
        this.structures,
        update.id,
        state,
        flags & UNIT_CLASS_STRUCTURE,
      );
      this.syncBoolean(
        this.warships,
        update.id,
        state,
        (flags & UNIT_CLASS_MOBILE) !== 0 && update.unitType === UnitType.Warship,
      );
      this.syncBoolean(
        this.progressStructures,
        update.id,
        state,
        isStructure &&
          (state?.underConstruction === true ||
            state?.markedForDeletion !== false ||
            update.unitType === UnitType.SAMLauncher ||
            update.unitType === UnitType.MissileSilo),
      );
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

      if (wasStructure || isStructure) {
        this.structureRevision++;
        structureDeltas.push(update);
      }
    }

    this.updateRustStructures(structureDeltas);
  }

  trailIdsInto(out: number[]): void {
    out.length = 0;
    for (const id of this.trails.keys()) out.push(id);
  }

  private updateRustStructures(changed: StructureRenderInput[]): void {
    if (!this.rustStructureInitialized) {
      // Rust may finish preloading after GameView already received initial unit
      // snapshots. Seed from the current structure subset once so the persistent
      // table can safely switch from full rebuilds to delta patches mid-match.
      changed.length = 0;
      for (const state of this.structures.values()) changed.push(state);
      const initial = updateStructureRenderDeltasRust(changed, this.mapWidth);
      if (initial === null) {
        this.structureRenderDelta = null;
        return;
      }
      this.rustStructureInitialized = true;
      this.structureRenderDelta = initial;
      return;
    }

    if (changed.length === 0) {
      this.structureRenderDelta = null;
      return;
    }

    const delta = updateStructureRenderDeltasRust(changed, this.mapWidth);
    if (delta === null) {
      // The live StructurePass will rebuild from the TypeScript structure map
      // on the next dirty update. Do not keep advertising a stale Rust patch.
      this.rustStructureInitialized = false;
      this.structureRenderDelta = null;
      return;
    }
    this.structureRenderDelta = delta;
  }

  private sync(
    target: Map<number, UnitState>,
    id: number,
    state: UnitState | undefined,
    member: number,
  ): void {
    this.syncBoolean(target, id, state, member !== 0);
  }

  private syncBoolean(
    target: Map<number, UnitState>,
    id: number,
    state: UnitState | undefined,
    member: boolean,
  ): void {
    if (member && state?.isActive) {
      target.set(id, state);
    } else {
      target.delete(id);
    }
  }
}
