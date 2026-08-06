interface LevelStructureState {
  isActive: boolean;
  unitType: string;
  level: number;
  pos: number;
}

export interface LevelStructureSnapshot {
  unitType: string;
  level: number;
  pos: number;
}

export function sameStructureLevels(
  units: ReadonlyMap<number, LevelStructureState>,
  structureTypes: ReadonlySet<string>,
  snapshot: LevelStructureSnapshot[],
): boolean {
  let index = 0;
  for (const unit of units.values()) {
    if (
      !unit.isActive ||
      !structureTypes.has(unit.unitType) ||
      unit.level <= 1
    ) {
      continue;
    }
    const previous = snapshot[index++];
    if (
      previous === undefined ||
      previous.unitType !== unit.unitType ||
      previous.level !== unit.level ||
      previous.pos !== unit.pos
    ) {
      return false;
    }
  }
  return index === snapshot.length;
}

export function captureStructureLevels(
  units: ReadonlyMap<number, LevelStructureState>,
  structureTypes: ReadonlySet<string>,
  snapshot: LevelStructureSnapshot[],
): void {
  let index = 0;
  for (const unit of units.values()) {
    if (
      !unit.isActive ||
      !structureTypes.has(unit.unitType) ||
      unit.level <= 1
    ) {
      continue;
    }
    const previous = snapshot[index];
    if (previous) {
      previous.unitType = unit.unitType;
      previous.level = unit.level;
      previous.pos = unit.pos;
    } else {
      snapshot.push({
        unitType: unit.unitType,
        level: unit.level,
        pos: unit.pos,
      });
    }
    index++;
  }
  snapshot.length = index;
}
