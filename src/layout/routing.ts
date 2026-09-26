/**
 * Turns partner and family links into SVG paths from the current box
 * positions. Kept separate from layout so that boxes can be dragged and their
 * lines follow.
 */
import { BUS_OFFSET, NODE_HEIGHT, NODE_WIDTH, type FamilyLink, type PartnerLink } from './types';

export interface Point {
  x: number;
  y: number;
}

export interface RoutedPath {
  key: string;
  d: string;
  kind: 'partner' | 'child';
  ended?: boolean;
  dashed?: boolean;
  /** Link this path belongs to, for highlighting and checking. */
  link: string;
}

const half = NODE_WIDTH / 2;

export function partnerPath(a: Point, b: Point, adjacent: boolean): string {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  if (left.y === right.y && (adjacent || right.x - left.x <= NODE_WIDTH * 1.5)) {
    return `M${left.x + half},${left.y}H${right.x - half}`;
  }
  if (left.y === right.y) {
    // Not side by side: arc above the row so the line does not pass through other people.
    const top = left.y - NODE_HEIGHT / 2;
    const lift = Math.min(60, 20 + (right.x - left.x) / 20);
    return `M${left.x},${top}C${left.x},${top - lift} ${right.x},${top - lift} ${right.x},${top}`;
  }
  return `M${left.x},${left.y}L${right.x},${right.y}`;
}

/** Where a family's line leaves its parents: from the line between a couple, or below a single parent. */
export function familyAnchor(parents: Point[], joined: boolean): Point {
  const x = parents.reduce((s, p) => s + p.x, 0) / parents.length;
  const sameRow = parents.every((p) => p.y === parents[0]!.y);
  const lowest = Math.max(...parents.map((p) => p.y));
  return { x, y: joined && sameRow && parents.length >= 2 ? lowest : lowest + NODE_HEIGHT / 2 };
}

export function routeLinks(
  partnerLinks: PartnerLink[],
  familyLinks: FamilyLink[],
  position: (key: string) => Point | undefined,
): RoutedPath[] {
  const paths: RoutedPath[] = [];
  for (const link of partnerLinks) {
    const a = position(link.a);
    const b = position(link.b);
    if (a && b) paths.push({ key: `p:${link.key}`, d: partnerPath(a, b, link.adjacent), kind: 'partner', ended: link.ended, link: link.key });
  }
  for (const link of familyLinks) {
    const parents = link.parents.map(position).filter((p): p is Point => !!p);
    if (parents.length === 0) continue;
    const anchor = familyAnchor(parents, link.joined);
    const children = link.children
      .map((c) => ({ ...c, at: position(c.key) }))
      .filter((c): c is { key: string; dashed: boolean; at: Point } => !!c.at);
    if (children.length === 0) continue;
    const busY = Math.min(...children.map((c) => c.at.y)) - NODE_HEIGHT / 2 - BUS_OFFSET;
    for (const child of children) {
      const top = child.at.y - NODE_HEIGHT / 2;
      const d =
        busY > anchor.y
          ? `M${anchor.x},${anchor.y}V${busY}H${child.at.x}V${top}`
          : `M${anchor.x},${anchor.y}L${child.at.x},${top}`;
      paths.push({ key: `c:${link.key}>${child.key}`, d, kind: 'child', dashed: child.dashed, link: link.key });
    }
  }
  return paths;
}
