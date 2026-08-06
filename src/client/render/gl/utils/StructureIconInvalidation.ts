interface IconStructureState {
  isActive: boolean;
  unitType: string;
  pos: number;
  ownerID: number;
  underConstruction: boolean;
  markedForDeletion: number | false;
}

interface StructureTypeLookup {
  has(unitType: string): boolean;
}

export interface IconStructureSnapshot {
  unitType: string;
  pos: number;
  ownerID: number;
  underConstruction: boolean;
  markedForDeletion: boolean;
}

export function sameStructureIcons(
  units: ReadonlyMap<number, IconStructureState>,
  visibleTypes: StructureTypeLookup,
  snapshot: IconStructureSnapshot[],
): boolean {
  let index = 0;
  for (const unit of units.values()) {
    if (!unit.isActive || !visibleTypes.has(unit.unitType)) continue;
    const previous = snapshot[index++];
    if (
      previous === undefined ||
      previous.unitType !== unit.unitType ||
      previous.pos !== unit.pos ||
      previous.ownerID !== unit.ownerID ||
      previous.underConstruction !== unit.underConstruction ||
      previous.markedForDeletion !== (unit.markedForDeletion !== false)
    ) {
      return false;
    }
  }
  return index === snapshot.length;
}

export function captureStructureIcons(
  units: ReadonlyMap<number, IconStructureState>,
  visibleTypes: StructureTypeLookup,
  snapshot: IconStructureSnapshot[],
): void {
  let index = 0;
  for (const unit of units.values()) {
    if (!unit.isActive || !visibleTypes.has(unit.unitType)) continue;
    const previous = snapshot[index];
    if (previous) {
      previous.unitType = unit.unitType;
      previous.pos = unit.pos;
      previous.ownerID = unit.ownerID;
      previous.underConstruction = unit.underConstruction;
      previous.markedForDeletion = unit.markedForDeletion !== false;
    } else {
      snapshot.push({
        unitType: unit.unitType,
        pos: unit.pos,
        ownerID: unit.ownerID,
        underConstruction: unit.underConstruction,
        markedForDeletion: unit.markedForDeletion !== false,
      });
    }
    index++;
  }
  snapshot.length = index;
}
