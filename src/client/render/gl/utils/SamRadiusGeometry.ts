const TWO_PI = Math.PI * 2;
const EPS = 1e-9;

export interface SAMCircle {
  x: number;
  y: number;
  radius: number;
  color: number[];
  group: number;
}

type Interval = [number, number];

function normalizeAngle(a: number): number {
  while (a < 0) a += TWO_PI;
  while (a >= TWO_PI) a -= TWO_PI;
  return a;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const flat: Interval[] = [];
  for (const [s, e] of intervals) {
    const ns = normalizeAngle(s);
    const ne = normalizeAngle(e);
    if (ne < ns) {
      flat.push([ns, TWO_PI]);
      flat.push([0, ne]);
    } else {
      flat.push([ns, ne]);
    }
  }
  flat.sort((a, b) => a[0] - b[0]);

  const merged: Interval[] = [];
  let cur: Interval = [flat[0][0], flat[0][1]];
  for (let i = 1; i < flat.length; i++) {
    const it = flat[i];
    if (it[0] <= cur[1] + EPS) {
      cur[1] = Math.max(cur[1], it[1]);
    } else {
      merged.push(cur);
      cur = [it[0], it[1]];
    }
  }
  merged.push(cur);
  return merged;
}

/** Compute the uncovered arc intervals for circle `a` given all circles. */
export function computeUncoveredArcs(
  a: SAMCircle,
  circles: SAMCircle[],
): Interval[] {
  const covered: Interval[] = [];

  for (const b of circles) {
    if (a === b || a.group !== b.group) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d + a.radius <= b.radius + EPS) return [];
    if (d >= a.radius + b.radius - EPS) continue;
    if (d <= EPS) {
      if (b.radius >= a.radius) return [];
      continue;
    }

    const cosPhi =
      (a.radius * a.radius + d * d - b.radius * b.radius) / (2 * a.radius * d);
    const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
    const theta = Math.atan2(dy, dx);
    covered.push([theta - phi, theta + phi]);
  }

  const merged = mergeIntervals(covered);
  if (merged.length === 0) return [[0, TWO_PI]];

  const uncovered: Interval[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor + EPS) uncovered.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < TWO_PI - EPS) uncovered.push([cursor, TWO_PI]);
  return uncovered;
}
