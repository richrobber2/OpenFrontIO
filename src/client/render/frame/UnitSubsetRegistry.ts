import type { UnitState } from "../types";

export interface UnitRenderSubsets {
  readonly mobile: ReadonlyMap<number, UnitState>;
  readonly structures: ReadonlyMap<number, UnitState>;
  readonly structureRevision: number;
}

const subsetsByMasterMap = new WeakMap<object, UnitRenderSubsets>();

/**
 * Associate GameView's long-lived master UnitState map with its Rust-backed
 * incremental subsets. The master map is the stable key already passed through
 * the existing renderer API, so hot passes can consume the subsets without
 * adding another per-frame frame-contract field or rebuilding classifications.
 */
export function registerUnitRenderSubsets(
  master: ReadonlyMap<number, UnitState>,
  subsets: UnitRenderSubsets,
): void {
  subsetsByMasterMap.set(master as object, subsets);
}

/** Resolve Rust-backed subsets for a master UnitState map when available. */
export function getUnitRenderSubsets(
  master: ReadonlyMap<number, UnitState>,
): UnitRenderSubsets | null {
  return subsetsByMasterMap.get(master as object) ?? null;
}
