/** Atlas columns 3–8 are the contiguous missile/projectile block. */
export function isMissileAtlasColumn(atlasColumn: number): boolean {
  return atlasColumn >= 3 && atlasColumn <= 8;
}
