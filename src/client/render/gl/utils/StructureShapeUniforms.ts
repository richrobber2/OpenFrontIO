interface StructureShapeVisual {
  scale?: number;
  iconFill?: number;
}

export function updateStructureShapeBuffers(
  structureOrder: readonly string[],
  shapes: Readonly<Record<string, StructureShapeVisual | undefined>>,
  scales: Float32Array,
  fills: Float32Array,
): boolean {
  let changed = false;
  for (let i = 0; i < structureOrder.length; i++) {
    const shape = shapes[structureOrder[i]];
    const scale = Math.fround(shape?.scale ?? 1);
    const fill = Math.fround(shape?.iconFill ?? 0.6);
    if (scales[i] !== scale) {
      scales[i] = scale;
      changed = true;
    }
    if (fills[i] !== fill) {
      fills[i] = fill;
      changed = true;
    }
  }
  return changed;
}
