/**
 * Independent geometric verification of a drawn tree: finds lines that cross
 * other families' lines, lines that pass through someone else's box, and boxes
 * that overlap. The focus layout uses it as a final safety net, and the tests
 * use it to prove that focus views are free of crossings.
 */
import { routeLinks, type Point } from './routing';
import { NODE_HEIGHT, NODE_WIDTH, type TreeLayout } from './types';

export interface LayoutProblem {
  kind: 'crossing' | 'line-through-box' | 'box-overlap';
  /** Node keys involved (for boxes) or link keys (for lines). */
  keys: string[];
}

interface Segment {
  a: Point;
  b: Point;
  link: string;
}

const EPS = 0.5;

/** Parses the subset of SVG path syntax produced by routing.ts into straight segments. */
export function pathSegments(d: string): [Point, Point][] {
  const tokens = d.match(/[MHVLC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const segments: [Point, Point][] = [];
  let i = 0;
  let current: Point = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++]!;
    if (command === 'M') current = { x: num(), y: num() };
    else if (command === 'H') {
      const next = { x: num(), y: current.y };
      segments.push([current, next]);
      current = next;
    } else if (command === 'V') {
      const next = { x: current.x, y: num() };
      segments.push([current, next]);
      current = next;
    } else if (command === 'L') {
      const next = { x: num(), y: num() };
      segments.push([current, next]);
      current = next;
    } else if (command === 'C') {
      // Approximate the curve by its control polygon (it lies within it).
      const c1 = { x: num(), y: num() };
      const c2 = { x: num(), y: num() };
      const end = { x: num(), y: num() };
      segments.push([current, c1], [c1, c2], [c2, end]);
      current = end;
    }
  }
  return segments;
}

function orientation(p: Point, q: Point, r: Point): number {
  const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : 2;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q.x <= Math.max(p.x, r.x) + 1e-9 &&
    q.x >= Math.min(p.x, r.x) - 1e-9 &&
    q.y <= Math.max(p.y, r.y) + 1e-9 &&
    q.y >= Math.min(p.y, r.y) - 1e-9
  );
}

export function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

interface Box {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function segmentHitsBox(s: Segment, box: Box): boolean {
  // Shrink the box slightly so lines ending on its edge do not count.
  const b = { x1: box.x1 + EPS, y1: box.y1 + EPS, x2: box.x2 - EPS, y2: box.y2 - EPS };
  const inside = (p: Point) => p.x > b.x1 && p.x < b.x2 && p.y > b.y1 && p.y < b.y2;
  if (inside(s.a) || inside(s.b)) return true;
  const corners: Point[] = [
    { x: b.x1, y: b.y1 },
    { x: b.x2, y: b.y1 },
    { x: b.x2, y: b.y2 },
    { x: b.x1, y: b.y2 },
  ];
  return corners.some((c, i) => segmentsIntersect(s.a, s.b, c, corners[(i + 1) % 4]!));
}

export function findLayoutProblems(layout: TreeLayout): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const positions = new Map(layout.nodes.map((n) => [n.key, { x: n.x, y: n.y }]));
  const paths = routeLinks(layout.partnerLinks, layout.familyLinks, (k) => positions.get(k));

  // Which node keys each link connects, and which links may touch each other.
  const members = new Map<string, Set<string>>();
  for (const l of layout.partnerLinks) members.set(l.key, new Set([l.a, l.b]));
  for (const l of layout.familyLinks) members.set(l.key, new Set([...l.parents, ...l.children.map((c) => c.key)]));
  const mayTouch = (x: string, y: string) => {
    if (x === y) return true;
    const partner = layout.partnerLinks.find((l) => l.key === x || l.key === y);
    const family = layout.familyLinks.find((l) => l.key === x || l.key === y);
    // A couple's partner line and the line to their children meet by design.
    return !!partner && !!family && family.parents.includes(partner.a) && family.parents.includes(partner.b);
  };

  const segments: Segment[] = paths.flatMap((p) => pathSegments(p.d).map(([a, b]) => ({ a, b, link: p.link })));
  const boxes: Box[] = layout.nodes.map((n) => ({
    key: n.key,
    x1: n.x - NODE_WIDTH / 2,
    y1: n.y - NODE_HEIGHT / 2,
    x2: n.x + NODE_WIDTH / 2,
    y2: n.y + NODE_HEIGHT / 2,
  }));

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.x1 < b.x2 - EPS && b.x1 < a.x2 - EPS && a.y1 < b.y2 - EPS && b.y1 < a.y2 - EPS) {
        problems.push({ kind: 'box-overlap', keys: [a.key, b.key] });
      }
    }
  }

  for (const s of segments) {
    const own = members.get(s.link)!;
    for (const box of boxes) {
      if (!own.has(box.key) && segmentHitsBox(s, box)) problems.push({ kind: 'line-through-box', keys: [s.link, box.key] });
    }
  }

  const seen = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i]!;
      const t = segments[j]!;
      if (mayTouch(s.link, t.link)) continue;
      if (segmentsIntersect(s.a, s.b, t.a, t.b)) {
        const key = [s.link, t.link].sort().join('×');
        if (!seen.has(key)) {
          seen.add(key);
          problems.push({ kind: 'crossing', keys: [s.link, t.link] });
        }
      }
    }
  }
  return problems;
}
