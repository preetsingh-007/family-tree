/**
 * Horizontal space taken by part of a drawing, per "level": even levels are
 * rows of boxes (level = 2 × generation), odd levels are the gaps between rows
 * where family lines run. Two parts whose occupancies are disjoint (with a
 * margin) at every level cannot overlap or cross each other.
 */

export type Interval = [number, number];

export class Occupancy {
  private readonly levels = new Map<number, Interval[]>();

  static row(generation: number): number {
    return generation * 2;
  }

  static gapBelow(generation: number): number {
    return generation * 2 + 1;
  }

  get(level: number): readonly Interval[] {
    return this.levels.get(level) ?? [];
  }

  entries(): IterableIterator<[number, Interval[]]> {
    return this.levels.entries();
  }

  add(level: number, lo: number, hi: number): this {
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    const list = this.levels.get(level) ?? [];
    const merged: Interval[] = [];
    let current: Interval = [a, b];
    for (const interval of list) {
      if (interval[1] < current[0] || interval[0] > current[1]) merged.push(interval);
      else current = [Math.min(current[0], interval[0]), Math.max(current[1], interval[1])];
    }
    merged.push(current);
    merged.sort((x, y) => x[0] - y[0]);
    this.levels.set(level, merged);
    return this;
  }

  addAll(other: Occupancy, dx = 0): this {
    for (const [level, list] of other.levels) for (const [lo, hi] of list) this.add(level, lo + dx, hi + dx);
    return this;
  }

  clone(dx = 0): Occupancy {
    return new Occupancy().addAll(this, dx);
  }

  /** Leftmost / rightmost occupied x at a level (undefined when empty). */
  extent(level: number): Interval | undefined {
    const list = this.levels.get(level);
    return list?.length ? [list[0]![0], list[list.length - 1]![1]] : undefined;
  }

  /** True if any interval of `other` (shifted by dx) comes within `gap` of this occupancy. */
  conflicts(other: Occupancy, gap: number, dx = 0): boolean {
    for (const [level, list] of other.levels) {
      const mine = this.levels.get(level);
      if (!mine) continue;
      for (const [lo, hi] of list) if (overlapsAny(mine, lo + dx, hi + dx, gap)) return true;
    }
    return false;
  }

  /** True if [lo, hi] at `level` comes within `gap` of this occupancy. */
  hits(level: number, lo: number, hi: number, gap: number): boolean {
    const mine = this.levels.get(level);
    return !!mine && overlapsAny(mine, Math.min(lo, hi), Math.max(lo, hi), gap);
  }
}

const TOLERANCE = 1e-6;

function overlapsAny(list: Interval[], lo: number, hi: number, gap: number): boolean {
  for (const [a, b] of list) {
    if (a >= hi + gap - TOLERANCE) break;
    if (lo < b + gap - TOLERANCE && a < hi + gap - TOLERANCE) return true;
  }
  return false;
}

/**
 * The x-offset closest to `preferred` at which `add` fits next to `base`
 * (keeping `gap`), optionally within bounds and passing an extra check.
 * Candidates are the edges of the forbidden ranges, so the result is exact.
 */
export function findOffset(
  base: Occupancy,
  add: Occupancy,
  gap: number,
  preferred: number,
  options: { min?: number; max?: number; accept?: (dx: number) => boolean; candidates?: number[] } = {},
): number | undefined {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  const forbidden: Interval[] = [];
  for (const [level, list] of add.entries()) {
    const mine = base.get(level);
    for (const [blo, bhi] of list) for (const [alo, ahi] of mine) forbidden.push([alo - bhi - gap, ahi - blo + gap]);
  }
  const blocked = (dx: number) => dx < min - TOLERANCE || dx > max + TOLERANCE || forbidden.some(([lo, hi]) => dx > lo + TOLERANCE && dx < hi - TOLERANCE);
  const candidates = new Set<number>([preferred, ...(options.candidates ?? [])]);
  for (const [lo, hi] of forbidden) {
    candidates.add(lo);
    candidates.add(hi);
  }
  if (Number.isFinite(min)) candidates.add(min);
  if (Number.isFinite(max)) candidates.add(max);
  const ordered = [...candidates].filter((c) => Number.isFinite(c)).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
  for (const dx of ordered) {
    if (blocked(dx)) continue;
    if (options.accept && !options.accept(dx)) continue;
    return dx;
  }
  return undefined;
}
