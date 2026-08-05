export function isWithinRailConnectionRange({
  distanceSquared,
  minimumRange,
  maximumRange,
}: {
  distanceSquared: number;
  minimumRange: number;
  maximumRange: number;
}): boolean {
  if (
    !Number.isFinite(distanceSquared) ||
    distanceSquared < 0 ||
    minimumRange < 0 ||
    maximumRange < minimumRange
  ) {
    return false;
  }
  return (
    distanceSquared > minimumRange ** 2 && distanceSquared <= maximumRange ** 2
  );
}
