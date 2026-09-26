/** Output shared by both tree layout engines, and drawing constants. */
import type { Id, Person } from '../model/types';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
export const ROW_HEIGHT = 150;
/** Distance of a family's horizontal connecting line above its children. */
export const BUS_OFFSET = 26;

export interface LayoutNode {
  /** Unique within the layout: the person id, or an "echo:" key for a repeated person. */
  key: string;
  person: Person;
  x: number;
  y: number;
  generation: number;
  /** A faded copy of someone drawn elsewhere, used instead of a crossing line. */
  echo?: boolean;
}

export interface PartnerLink {
  key: string;
  a: string;
  b: string;
  ended: boolean;
  /** Nothing is drawn between the two partners, so a straight line joins them (otherwise an arc). */
  adjacent: boolean;
}

/** Lines from one set of parents to their children (keys refer to LayoutNode.key). */
export interface FamilyLink {
  key: string;
  parents: string[];
  children: { key: string; dashed: boolean }[];
  /** The parents are side by side, so the line starts between them rather than below them. */
  joined: boolean;
}

export interface TreeLayout {
  nodes: LayoutNode[];
  partnerLinks: PartnerLink[];
  familyLinks: FamilyLink[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Direct relatives not drawn at all (neither as a box nor as an echo), per person. */
  hiddenRelatives: Map<Id, number>;
  /** Families whose children are hidden by the user, with where to show them again. */
  collapsedFamilies: CollapsedFamily[];
}

export interface CollapsedFamily {
  /** Family key (see families.ts). */
  key: string;
  /** Node keys of the parents that are drawn. */
  parents: string[];
  /** How many descendants are hidden. */
  hidden: number;
}

export interface ViewOptions {
  /** Family steps from the focus person; Infinity shows everyone. */
  radius: number;
  /** People whose direct relatives are shown even beyond the radius. */
  expanded?: ReadonlySet<Id>;
  /** Families (keys from families.ts) whose children and further descendants are hidden. */
  collapsed?: ReadonlySet<string>;
}

export function boundsOf(nodes: { x: number; y: number }[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    minX: Math.min(...xs) - NODE_WIDTH / 2,
    maxX: Math.max(...xs) + NODE_WIDTH / 2,
    minY: Math.min(...ys) - NODE_HEIGHT / 2 - 30,
    maxY: Math.max(...ys) + NODE_HEIGHT / 2,
  };
}
