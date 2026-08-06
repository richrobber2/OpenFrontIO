import type { DefensePostPosition } from "./OverlayInvalidation";

interface DefenseStructureState {
  unitType: string;
  underConstruction: boolean;
  pos: number;
  ownerID: number;
}

export function collectCompletedDefensePosts(
  units: ReadonlyMap<number, DefenseStructureState>,
  mapWidth: number,
  output: DefensePostPosition[],
): DefensePostPosition[] {
  let count = 0;
  for (const unit of units.values()) {
    if (unit.unitType !== "Defense Post" || unit.underConstruction) continue;
    const x = unit.pos % mapWidth;
    const existing = output[count];
    if (existing) {
      existing.x = x;
      existing.y = (unit.pos - x) / mapWidth;
      existing.ownerID = unit.ownerID;
    } else {
      output.push({
        x,
        y: (unit.pos - x) / mapWidth,
        ownerID: unit.ownerID,
      });
    }
    count++;
  }
  output.length = count;
  return output;
}
