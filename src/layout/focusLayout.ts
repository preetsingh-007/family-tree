/**
 * Crossing-free layout of the family around one person (the "focus view").
 *
 * 1. Visibility: people within `radius` family steps (parent/child = 1 step,
 *    partner = 0), plus the direct relatives of "expanded" people, minus the
 *    children (and further descendants) of families the user has collapsed.
 * 2. Unfolding: starting from the focus person and growing outwards (nearest
 *    first), every family unit (parents + children) is attached to the person
 *    through whom it was first reached. Someone reached a second time, which
 *    only happens when the family forms a loop (cousins marrying, two brothers
 *    marrying two sisters, …), is drawn as an "echo" box instead of a line
 *    back to their first appearance. The result is a tree.
 * 3. Drawing: the tree is laid out recursively in generational rows. Each part
 *    records the exact horizontal space it occupies on every row and in every
 *    gap between rows (see Occupancy), including its lines. A part is only
 *    accepted at a position where it — and the new lines connecting it — are
 *    clear of everything already drawn. A branch that cannot be placed cleanly
 *    is left out, and the person it hangs from shows a "+" instead.
 *
 * Because every accepted placement is checked this way, the result has no
 * crossing lines and no overlapping boxes. `findLayoutProblems` (check.ts)
 * verifies this independently in the tests, and is also applied here as a
 * final safety net.
 */
import type { TreeIndex } from '../model/relatives';
import type { Id } from '../model/types';
import { findLayoutProblems } from './check';
import { relativeCounts } from './counts';
import { buildFamilies, type Family, type FamilyIndex } from './families';
import { findOffset, Occupancy } from './occupancy';
import {
  boundsOf,
  NODE_WIDTH,
  ROW_HEIGHT,
  type FamilyLink,
  type LayoutNode,
  type PartnerLink,
  type TreeLayout,
  type ViewOptions,
} from './types';

const HALF = NODE_WIDTH / 2;
/** Space between a couple's boxes (their partner line runs here). */
const PARTNER_GAP = 36;
/** Minimum clearance between unrelated parts of the drawing. */
const CLEARANCE = 24;
/** Preferred space between siblings. */
const SIBLING_GAP = 32;

type Side = 'L' | 'R';
/** Which way a person's block grows: C = the focus person, M = a middle child (no room above). */
type Direction = 'L' | 'R' | 'C' | 'M';

interface Member {
  id: Id;
  echo: boolean;
}

interface Attachment {
  family: Family;
  entry: Id;
  role: 'down' | 'up';
  parents: Member[];
  children: Member[];
}

// --------------------------------------------------------------------------------------------
// 1. Visibility
// --------------------------------------------------------------------------------------------

function neighbours(index: TreeIndex, id: Id) {
  const result: { id: Id; cost: 0 | 1; down: boolean }[] = [];
  for (const p of index.partnershipsByPerson.get(id) ?? []) {
    result.push({ id: p.partnerIds[0] === id ? p.partnerIds[1] : p.partnerIds[0], cost: 0, down: false });
  }
  for (const l of index.linksByChild.get(id) ?? []) result.push({ id: l.parentId, cost: 1, down: false });
  for (const l of index.linksByParent.get(id) ?? []) result.push({ id: l.childId, cost: 1, down: true });
  return result;
}

/** Distance (in family steps) of every visible person from the focus. */
function visiblePeople(
  index: TreeIndex,
  families: FamilyIndex,
  focusId: Id,
  options: ViewOptions,
  excluded: ReadonlySet<Id>,
): Map<Id, number> {
  const expanded = options.expanded ?? new Set<Id>();
  const collapsed = options.collapsed ?? new Set<string>();
  const distance = new Map<Id, number>([[focusId, 0]]);
  const deque: Id[] = [focusId];
  while (deque.length) {
    const id = deque.shift()!;
    const d = distance.get(id)!;
    for (const n of neighbours(index, id)) {
      if (!index.people.has(n.id) || excluded.has(n.id)) continue;
      // A collapsed family's children (and so everything below them) are hidden.
      if (n.down && collapsed.has(families.childFamily.get(n.id) ?? '')) continue;
      let next = d + n.cost;
      if (next > options.radius) {
        if (!expanded.has(id)) continue;
        next = options.radius;
      }
      const known = distance.get(n.id);
      if (known !== undefined && known <= next) continue;
      distance.set(n.id, next);
      if (n.cost === 0) deque.unshift(n.id);
      else deque.push(n.id);
    }
  }
  return distance;
}

// --------------------------------------------------------------------------------------------
// 2. Unfolding into a tree of family attachments
// --------------------------------------------------------------------------------------------

function unfold(focusId: Id, families: FamilyIndex, visible: Map<Id, number>, collapsed: ReadonlySet<string>) {
  const attachments = new Map<Id, Attachment[]>();
  const attached = new Set<string>();
  const reached = new Set<Id>([focusId]);
  const queue: Id[] = [focusId];
  const order = (a: Id, b: Id) => visible.get(a)! - visible.get(b)!;

  while (queue.length) {
    queue.sort(order);
    const person = queue.shift()!;
    const keys = [...(families.parentFamilies.get(person) ?? [])];
    const up = families.childFamily.get(person);
    if (up) keys.push(up);
    for (const key of keys) {
      if (attached.has(key)) continue;
      const family = families.families.get(key)!;
      const role = family.parents.includes(person) ? 'down' : 'up';
      const childrenHidden = collapsed.has(key);
      const members = (ids: Id[]) =>
        ids
          .filter((id) => id !== person && visible.has(id))
          .map((id) => ({ id, echo: reached.has(id) }));
      const parents = members(family.parents);
      const children = childrenHidden ? [] : members(family.children);
      if (parents.length + children.length === 0) continue;
      // Siblings are only drawn below their parents.
      if (role === 'up' && parents.length === 0) continue;
      attached.add(key);
      const attachment: Attachment = { family, entry: person, role, parents, children };
      const list = attachments.get(person);
      if (list) list.push(attachment);
      else attachments.set(person, [attachment]);
      for (const m of [...parents, ...children]) {
        if (m.echo) continue;
        reached.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return attachments;
}

// --------------------------------------------------------------------------------------------
// 3. Recursive drawing
// --------------------------------------------------------------------------------------------

interface DrawnNode {
  key: string;
  id: Id;
  echo: boolean;
  x: number;
  generation: number;
}

class Block {
  nodes: DrawnNode[] = [];
  partnerLinks: PartnerLink[] = [];
  familyLinks: FamilyLink[] = [];
  occupancy = new Occupancy();

  static single(key: string, id: Id, echo: boolean, generation: number): Block {
    const block = new Block();
    block.nodes.push({ key, id, echo, x: 0, generation });
    block.occupancy.add(Occupancy.row(generation), -HALF, HALF);
    return block;
  }

  node(key: string): DrawnNode {
    return this.nodes.find((n) => n.key === key)!;
  }

  /** Adds another block, shifted by dx. */
  absorb(other: Block, dx: number) {
    for (const n of other.nodes) this.nodes.push({ ...n, x: n.x + dx });
    this.partnerLinks.push(...other.partnerLinks);
    this.familyLinks.push(...other.familyLinks);
    this.occupancy.addAll(other.occupancy, dx);
  }
}

const echoKey = (family: Family, id: Id) => `echo:${family.key}:${id}`;

/**
 * "Nothing may be drawn beyond this person's box on `side`, at `level`":
 * keeps the space next to someone free for the partner who must stand there,
 * and is passed on to their ancestors, whose other descendants would
 * otherwise land in that space.
 */
interface Seal {
  side: Side;
  level: number;
}

interface PersonOptions {
  /** Draw the person's parents and siblings. */
  allowUp: boolean;
  /** Partners may be placed on both sides (otherwise only on the outward side). */
  bothSides: boolean;
  /** Partners may be drawn with their own parents. */
  partnersMayRise: boolean;
  /** Draw the person's own partners and children. */
  ownFamilies: boolean;
  /** Draw siblings with their own partners and children. */
  siblingFamilies: boolean;
  seals: Seal[];
}

/** Progressively simpler ways to draw an ancestor when the full version does not fit. */
const ANCESTOR_LADDER: Pick<PersonOptions, 'allowUp' | 'ownFamilies' | 'siblingFamilies'>[] = [
  { allowUp: true, ownFamilies: true, siblingFamilies: true },
  { allowUp: true, ownFamilies: false, siblingFamilies: true },
  { allowUp: true, ownFamilies: false, siblingFamilies: false },
  { allowUp: false, ownFamilies: false, siblingFamilies: false },
];

const opposite = (side: Side): Side => (side === 'L' ? 'R' : 'L');

/** How many generations below someone the reserved space extends. */
const SEAL_DEPTH = 3;

/**
 * Reserves `side` of a person from the gap just above their row (where their
 * parents' line arrives) down through the rows below.
 */
function sealFrom(side: Side, generation: number): Seal[] {
  const seals: Seal[] = [];
  for (let level = Occupancy.row(generation) - 1; level <= Occupancy.row(generation + SEAL_DEPTH); level++) seals.push({ side, level });
  return seals;
}

/** Keeps a family's children on one side of the parent they share with another family. */
interface CentreSeal {
  side: Side;
  x: number;
  from: number;
}

function crossesCentre(occupancy: Occupancy, dx: number, seal: CentreSeal): boolean {
  for (const [level, list] of occupancy.entries()) {
    if (level < seal.from) continue;
    for (const [lo, hi] of list) if (seal.side === 'L' ? lo + dx < seal.x - 1e-6 : hi + dx > seal.x + 1e-6) return true;
  }
  return false;
}

/** Offsets at which `occupancy` just touches the reserved spaces (candidate positions). */
function sealCandidates(occupancy: Occupancy, box: [number, number], seals: Seal[], centre?: CentreSeal): number[] {
  const result: number[] = [];
  for (const seal of seals) {
    const extent = occupancy.extent(seal.level);
    if (extent) result.push(seal.side === 'R' ? box[1] - extent[1] : box[0] - extent[0]);
  }
  if (centre) {
    for (const [level, list] of occupancy.entries()) {
      if (level < centre.from || !list.length) continue;
      result.push(centre.side === 'L' ? centre.x - list[0]![0] : centre.x - list[list.length - 1]![1]);
    }
  }
  return result;
}

function breaksSeals(occupancy: Occupancy, dx: number, box: [number, number], seals: Seal[]): boolean {
  for (const seal of seals) {
    for (const [lo, hi] of occupancy.get(seal.level)) {
      if (seal.side === 'R' ? hi + dx > box[1] + 1e-6 : lo + dx < box[0] - 1e-6) return true;
    }
  }
  return false;
}

class Drawer {
  private readonly memo = new Map<string, Block>();

  constructor(private readonly attachments: Map<Id, Attachment[]>) {}

  /** Draws a person and everything attached through them, facing `direction`. */
  person(id: Id, generation: number, direction: Direction, options: PersonOptions): Block {
    // The same person is drawn with the same parameters when a placement is retried.
    const memoKey = `${id}|${generation}|${direction}|${JSON.stringify(options)}`;
    const cached = this.memo.get(memoKey);
    if (cached) return cached;

    const block = Block.single(id, id, false, generation);
    const attachments = this.attachments.get(id) ?? [];
    const downs = options.ownFamilies ? attachments.filter((a) => a.role === 'down') : [];
    const up = options.allowUp ? attachments.find((a) => a.role === 'up') : undefined;

    const outward: Side = direction === 'L' ? 'L' : 'R';
    const sealed = new Set(options.seals.filter((s) => s.level === Occupancy.row(generation)).map((s) => s.side));
    const slots = (options.bothSides ? [outward, opposite(outward)] : [outward]).filter((s) => !sealed.has(s));

    // Siblings go on the side without partners when possible (so partners' parents can be drawn).
    const couples = downs.filter((d) => d.parents.length > 0);
    const partnerSides = new Set(couples.slice(0, slots.length).map((_, i) => slots[i]!));
    const siblingSide = this.siblingSides(up, id, direction, partnerSides, sealed);

    // With partners on both sides, each couple's children stay on their own side of this person.
    const bothSidesUsed = couples.length > 1 && slots.length > 1;
    let slot = 0;
    for (const down of downs) {
      let side: Side | undefined;
      if (down.parents.length > 0) {
        side = slots[slot++];
        if (!side) continue; // No room for another partner next to this person.
      }
      const rise =
        options.partnersMayRise && side !== undefined && !siblingSide.includes(side) && (side === outward || direction === 'C');
      const own = block.node(id).x;
      const keepSide: CentreSeal | undefined =
        bothSidesUsed && side ? { side: opposite(side), x: own, from: Occupancy.gapBelow(generation) } : undefined;
      this.addDown(block, id, generation, down, side ?? outward, rise, options.seals, keepSide);
    }
    if (up) this.addUp(block, id, generation, up, siblingSide, options);
    this.memo.set(memoKey, block);
    return block;
  }

  /** For each sibling (in family order), which side of the person they are drawn on. */
  private siblingSides(up: Attachment | undefined, id: Id, direction: Direction, partnerSides: Set<Side>, sealed: Set<Side>): Side[] {
    if (!up) return [];
    if (direction === 'L' || direction === 'R') return up.children.map(() => direction);
    const order = up.family.children;
    const mine = order.indexOf(id);
    let sides = up.children.map((c) => (order.indexOf(c.id) < mine ? 'L' : 'R') as Side);
    if (partnerSides.size === 1) {
      const free: Side = partnerSides.has('L') ? 'R' : 'L';
      sides = sides.map(() => free);
    }
    return sides.map((s) => (sealed.has(s) ? opposite(s) : s));
  }

  private memberBlock(m: Member, family: Family, generation: number, build: () => Block): { block: Block; key: string } {
    if (m.echo) {
      const key = echoKey(family, m.id);
      return { block: Block.single(key, m.id, true, generation), key };
    }
    return { block: build(), key: m.id };
  }

  /** A person's partners in one family (beside them), and those partners' children (below). */
  private addDown(
    block: Block,
    id: Id,
    generation: number,
    a: Attachment,
    side: Side,
    partnersMayRise: boolean,
    seals: Seal[],
    keepSide?: CentreSeal,
  ) {
    const row = Occupancy.row(generation);
    const sign = side === 'R' ? 1 : -1;
    const parentKeys: string[] = [id];
    const trial = new Block();
    trial.occupancy = block.occupancy.clone();
    const self = block.node(id);
    let previous = self;

    // Partners, one after another outward from the person. Their other
    // families are added after this couple's children, further out.
    // The space beside and below the couple belongs to them and their children.
    const partnerSeals = sealFrom(opposite(side), generation);
    for (const partner of a.parents) {
      const variants: PersonOptions[] = [
        { allowUp: partnersMayRise, siblingFamilies: true },
        { allowUp: partnersMayRise, siblingFamilies: false },
        { allowUp: false, siblingFamilies: false },
      ]
        .filter((v, i, all) => all.findIndex((w) => w.allowUp === v.allowUp && w.siblingFamilies === v.siblingFamilies) === i)
        .map((v) => ({ ...v, ownFamilies: false, bothSides: false, partnersMayRise: false, seals: partnerSeals }));
      let placed: { block: Block; key: string; dx: number } | undefined;
      for (const variant of variants) {
        const candidate = this.memberBlock(partner, a.family, generation, () => this.person(partner.id, generation, side, variant));
        const node = candidate.block.node(candidate.key);
        const preferred = previous.x + sign * (NODE_WIDTH + PARTNER_GAP) - node.x;
        const edge = previous.x + sign * HALF;
        const dx = findOffset(trial.occupancy, candidate.block.occupancy, CLEARANCE, preferred, {
          ...(side === 'R' ? { min: preferred } : { max: preferred }),
          // The partner line between the two boxes must be clear of everything else.
          accept: (d) =>
            !trial.occupancy.hits(row, edge + sign * CLEARANCE, node.x + d - sign * HALF, CLEARANCE - 1) &&
            !breaksSeals(candidate.block.occupancy, d, [self.x - HALF, self.x + HALF], seals),
          candidates: sealCandidates(candidate.block.occupancy, [self.x - HALF, self.x + HALF], seals),
        });
        // Prefer being next to each other over showing more of a partner's family far away.
        if (dx === undefined || Math.abs(dx - preferred) > NODE_WIDTH) continue;
        placed = { ...candidate, dx };
        break;
      }
      if (!placed) return; // This family cannot be drawn here.
      const node = placed.block.node(placed.key);
      const far = node.x + placed.dx - sign * HALF;
      trial.absorb(placed.block, placed.dx);
      trial.occupancy.add(row, previous.x + sign * HALF, far);
      parentKeys.push(placed.key);
      previous = { ...node, x: node.x + placed.dx };
    }

    const parentXs = parentKeys.map((k) => (k === id ? block.node(id).x : trial.node(k).x));
    const anchor = parentXs.reduce((s, x) => s + x, 0) / parentXs.length;
    const children = this.childrenRow(a, generation + 1, trial.occupancy, anchor, generation, seals, [self.x - HALF, self.x + HALF], keepSide);

    const partnership = a.family.partnership;
    if (partnership && parentKeys.length === 2) {
      block.partnerLinks.push({
        key: partnership.id,
        a: parentKeys[0]!,
        b: parentKeys[1]!,
        ended: !!partnership.end && (!!partnership.end.reason || !!partnership.end.date),
        adjacent: true,
      });
    }
    block.absorb(trial, 0);
    block.occupancy = trial.occupancy;
    if (children) {
      block.absorb(children.block, children.dx);
      block.occupancy.add(Occupancy.gapBelow(generation), children.bus[0], children.bus[1]);
      block.familyLinks.push({
        key: a.family.key,
        parents: parentKeys,
        children: children.keys.map((key, i) => ({ key, dashed: a.family.dashed.get(children.ids[i]!) ?? false })),
        joined: parentKeys.length > 1,
      });
    }

    // Now the partners' other families, on their far side.
    for (const partner of a.parents) {
      if (partner.echo || !parentKeys.includes(partner.id)) continue;
      const others = (this.attachments.get(partner.id) ?? []).filter((d) => d.role === 'down');
      let used = false;
      for (const other of others) {
        if (other.parents.length > 0) {
          if (used) continue; // Only one more partner fits, on the outer side.
          used = true;
        }
        this.addDown(block, partner.id, generation, other, side, false, partnerSeals);
      }
    }
  }

  /**
   * Lays out the children of a family side by side and finds where they fit
   * below their parents, together with the line joining them.
   */
  private childrenRow(
    a: Attachment,
    generation: number,
    base: Occupancy,
    anchor: number,
    parentGeneration: number,
    seals: Seal[],
    box: [number, number],
    keepSide?: CentreSeal,
  ) {
    if (a.children.length === 0) return undefined;
    const gap = Occupancy.gapBelow(parentGeneration);
    for (const [partnersMayRise, ownFamilies] of [
      [true, true],
      [false, true],
      [false, false],
    ] as const) {
      const row = new Block();
      const keys: string[] = [];
      const ids: Id[] = [];
      for (const [i, child] of a.children.entries()) {
        const n = a.children.length;
        const direction: Direction = n === 1 ? 'C' : i === 0 ? 'L' : i === n - 1 ? 'R' : 'M';
        const { block, key } = this.memberBlock(child, a.family, generation, () =>
          this.person(child.id, generation, direction, {
            allowUp: false,
            bothSides: true,
            partnersMayRise: partnersMayRise && direction !== 'M',
            ownFamilies,
            siblingFamilies: false,
            seals: [],
          }),
        );
        let dx = 0;
        if (keys.length) {
          const prev = row.node(keys[keys.length - 1]!);
          const node = block.node(key);
          const preferred = prev.x + NODE_WIDTH + SIBLING_GAP - node.x;
          const found = findOffset(row.occupancy, block.occupancy, CLEARANCE, preferred, { min: prev.x + NODE_WIDTH - node.x });
          if (found === undefined) break;
          dx = found;
        }
        row.absorb(block, dx);
        keys.push(key);
        ids.push(child.id);
      }
      if (keys.length !== a.children.length) continue;

      const xs = keys.map((k) => row.node(k).x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const busAt = (dx: number): [number, number] => [Math.min(anchor, lo + dx), Math.max(anchor, hi + dx)];
      const ownGap = row.occupancy.get(gap);
      const candidates: number[] = [];
      for (const [s, e] of [...base.get(gap), ...ownGap]) {
        candidates.push(s - CLEARANCE - hi, e + CLEARANCE - lo, s - CLEARANCE - anchor, e + CLEARANCE - anchor);
      }
      candidates.push(...sealCandidates(row.occupancy, box, seals, keepSide));
      const dx = findOffset(base, row.occupancy, CLEARANCE, anchor - (lo + hi) / 2, {
        candidates,
        accept: (d) => {
          const [s, e] = busAt(d);
          // Stay out of space reserved for someone else next to this person.
          if (breaksSeals(row.occupancy, d, box, seals)) return false;
          if (breaksSeals(new Occupancy().add(gap, s, e), 0, box, seals)) return false;
          if (keepSide && crossesCentre(row.occupancy, d, keepSide)) return false;
          if (base.hits(gap, s, e, CLEARANCE)) return false;
          // The family's own line must also stay clear of lines inside the children's row.
          return !ownGap.some(([os, oe]) => os + d < e + CLEARANCE && s < oe + d + CLEARANCE);
        },
      });
      if (dx !== undefined) return { block: row, dx, keys, ids, bus: busAt(dx) };
    }
    return undefined;
  }

  /** A person's parents (above) and siblings (beside them). */
  private addUp(block: Block, id: Id, generation: number, a: Attachment, siblingSides: Side[], options: PersonOptions) {
    const self = block.node(id);
    const box: [number, number] = [self.x - HALF, self.x + HALF];
    // Siblings: all of them with their families, then without, then none.
    const siblingPlans: ('families' | 'bare' | 'none')[] = a.children.length
      ? options.siblingFamilies
        ? ['families', 'bare', 'none']
        : ['bare', 'none']
      : ['none'];
    for (const plan of siblingPlans) {
      const trial = new Block();
      trial.absorb(block, 0);
      const childKeys: { key: string; id: Id }[] = [{ key: id, id }];
      let ok = true;
      if (plan !== 'none') {
        for (const side of ['L', 'R'] as Side[]) {
          const sibs = a.children.filter((_, i) => siblingSides[i] === side);
          // Nearest sibling first, moving outward.
          const ordered = side === 'L' ? [...sibs].reverse() : sibs;
          for (const [i, s] of ordered.entries()) {
            const outermost = i === ordered.length - 1;
            const { block: sb, key } = this.memberBlock(s, a.family, generation, () =>
              this.person(s.id, generation, side, {
                allowUp: false,
                bothSides: true,
                partnersMayRise: outermost && plan === 'families',
                ownFamilies: plan === 'families',
                siblingFamilies: false,
                seals: [],
              }),
            );
            const node = sb.node(key);
            const extent = trial.occupancy.extent(Occupancy.row(generation))!;
            const preferred = side === 'L' ? extent[0] - SIBLING_GAP - HALF - node.x : extent[1] + SIBLING_GAP + HALF - node.x;
            const dx = findOffset(trial.occupancy, sb.occupancy, CLEARANCE, preferred, {
              ...(side === 'L' ? { max: self.x - NODE_WIDTH - node.x } : { min: self.x + NODE_WIDTH - node.x }),
              accept: (d) => !breaksSeals(sb.occupancy, d, box, options.seals),
              candidates: sealCandidates(sb.occupancy, box, options.seals),
            });
            if (dx === undefined) {
              ok = false;
              break;
            }
            trial.absorb(sb, dx);
            childKeys.push({ key, id: s.id });
          }
          if (!ok) break;
        }
      }
      if (!ok) continue;

      const xs = childKeys.map((c) => trial.node(c.key).x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const gap = Occupancy.gapBelow(generation - 1);
      for (const parents of this.parentRows(a, generation - 1, options.seals, generation)) {
        const anchor = parents.anchor;
        const ownGap = parents.block.occupancy.get(gap);
        const busAt = (dx: number): [number, number] => [Math.min(anchor + dx, lo), Math.max(anchor + dx, hi)];
        const candidates: number[] = [];
        for (const [s, e] of trial.occupancy.get(gap)) candidates.push(s - CLEARANCE - anchor, e + CLEARANCE - anchor);
        for (const [s, e] of ownGap) candidates.push(lo - CLEARANCE - e, hi + CLEARANCE - s);
        candidates.push(...sealCandidates(parents.block.occupancy, box, options.seals));
        const dx = findOffset(trial.occupancy, parents.block.occupancy, CLEARANCE, (lo + hi) / 2 - anchor, {
          candidates,
          accept: (d) => {
            // Keep the space next to this person that others rely on.
            if (breaksSeals(parents.block.occupancy, d, box, options.seals)) return false;
            const [s, e] = busAt(d);
            if (breaksSeals(new Occupancy().add(gap, s, e), 0, box, options.seals)) return false;
            if (trial.occupancy.hits(gap, s, e, CLEARANCE)) return false;
            return !ownGap.some(([os, oe]) => os + d < e + CLEARANCE && s < oe + d + CLEARANCE);
          },
        });
        if (dx === undefined) continue;

        block.nodes = trial.nodes;
        block.partnerLinks = trial.partnerLinks;
        block.familyLinks = trial.familyLinks;
        block.occupancy = trial.occupancy;
        block.absorb(parents.block, dx);
        const [s, e] = busAt(dx);
        block.occupancy.add(gap, s, e);
        block.familyLinks.push({
          key: a.family.key,
          parents: parents.keys,
          children: childKeys.map((c) => ({ key: c.key, dashed: a.family.dashed.get(c.id) ?? false })),
          joined: parents.keys.length > 1,
        });
        return;
      }
    }
  }

  /**
   * Candidate parent rows, from fullest to simplest: parents side by side
   * (father's side on the left), each with their own relatives on their outer
   * side. Parents whose relatives would get in the way are drawn more simply.
   */
  private *parentRows(a: Attachment, generation: number, inherited: Seal[], childGeneration: number) {
    const count = a.parents.length;
    const level = Occupancy.row(generation);
    // Try every combination of simplifications, least simplified first.
    const combos: number[][] = [];
    const steps = ANCESTOR_LADDER.length;
    for (let total = 0; total <= (steps - 1) * count; total++) {
      const walk = (i: number, left: number, acc: number[]) => {
        if (i === count) {
          if (left === 0) combos.push(acc);
          return;
        }
        for (let s = Math.min(left, steps - 1); s >= 0; s--) walk(i + 1, left - s, [...acc, s]);
      };
      walk(0, total, []);
    }
    for (const combo of combos) {
      const row = new Block();
      const keys: string[] = [];
      let ok = true;
      for (const [i, parent] of a.parents.entries()) {
        const first = i === 0;
        const last = i === count - 1;
        const direction: Side = count > 1 && last ? 'R' : 'L';
        const seals: Seal[] = inherited.filter((s) => s.level >= Occupancy.row(childGeneration));
        if (count > 1 && !first) seals.push(...sealFrom('L', generation));
        if (count > 1 && !last) seals.push(...sealFrom('R', generation));
        const step = ANCESTOR_LADDER[combo[i]!]!;
        const { block, key } = this.memberBlock(parent, a.family, generation, () =>
          this.person(parent.id, generation, direction, {
            ...step,
            allowUp: step.allowUp && (first || last),
            bothSides: false,
            partnersMayRise: false,
            seals,
          }),
        );
        if (!keys.length) {
          row.absorb(block, 0);
          keys.push(key);
          continue;
        }
        const prev = row.node(keys[keys.length - 1]!);
        const node = block.node(key);
        const preferred = prev.x + NODE_WIDTH + PARTNER_GAP - node.x;
        const dx = findOffset(row.occupancy, block.occupancy, CLEARANCE, preferred, {
          min: preferred,
          accept: (d) => !row.occupancy.hits(level, prev.x + HALF + CLEARANCE, node.x + d - HALF, CLEARANCE - 1),
        });
        if (dx === undefined || dx - preferred > NODE_WIDTH * 2) {
          ok = false;
          break;
        }
        row.absorb(block, dx);
        row.occupancy.add(level, prev.x + HALF, node.x + dx - HALF);
        keys.push(key);
      }
      if (!ok) continue;
      const partnership = a.family.partnership;
      if (partnership && keys.length === 2) {
        row.partnerLinks.push({
          key: partnership.id,
          a: keys[0]!,
          b: keys[1]!,
          ended: !!partnership.end && (!!partnership.end.reason || !!partnership.end.date),
          adjacent: true,
        });
      }
      const xs = keys.map((k) => row.node(k).x);
      yield { block: row, keys, anchor: xs.reduce((s, x) => s + x, 0) / xs.length };
    }
  }
}

// --------------------------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------------------------

export function layoutFocus(index: TreeIndex, focusId: Id, options: ViewOptions): TreeLayout {
  const families = buildFamilies(index);
  const collapsed = options.collapsed ?? new Set<string>();
  const excluded = new Set<Id>();
  let layout: TreeLayout | undefined;
  // The drawing is correct by construction; the check is a safety net that
  // removes the farthest person involved in any problem and tries again.
  for (let attempt = 0; attempt < 25; attempt++) {
    const visible = visiblePeople(index, families, focusId, options, excluded);
    const attachments = unfold(focusId, families, visible, collapsed);
    const drawer = new Drawer(attachments);
    const block = drawer.person(focusId, 0, 'C', {
      allowUp: true,
      bothSides: true,
      partnersMayRise: true,
      ownFamilies: true,
      siblingFamilies: true,
      seals: [],
    });
    layout = toLayout(index, families, block, focusId, collapsed);
    const problems = findLayoutProblems(layout);
    if (problems.length === 0) return layout;
    const involved = new Set<Id>();
    for (const p of problems) {
      for (const key of p.keys) {
        const node = layout.nodes.find((n) => n.key === key);
        if (node) involved.add(node.person.id);
        const fam = layout.familyLinks.find((f) => f.key === key);
        for (const k of fam ? [...fam.parents, ...fam.children.map((c) => c.key)] : []) {
          const n = layout.nodes.find((x) => x.key === k);
          if (n) involved.add(n.person.id);
        }
      }
    }
    involved.delete(focusId);
    const farthest = [...involved].sort((a, b) => (visible.get(b) ?? 0) - (visible.get(a) ?? 0))[0];
    if (!farthest) break;
    excluded.add(farthest);
  }
  return layout!;
}

function toLayout(index: TreeIndex, families: FamilyIndex, block: Block, focusId: Id, collapsed: ReadonlySet<string>): TreeLayout {
  const shift = -block.node(focusId).x;
  const nodes: LayoutNode[] = block.nodes.map((n) => ({
    key: n.key,
    person: index.people.get(n.id)!,
    x: n.x + shift,
    y: n.generation * ROW_HEIGHT,
    generation: n.generation,
    echo: n.echo || undefined,
  }));
  const drawn = new Set(nodes.filter((n) => !n.echo).map((n) => n.person.id));
  const echoed = new Set(nodes.filter((n) => n.echo).map((n) => n.person.id));
  return {
    nodes,
    partnerLinks: block.partnerLinks,
    familyLinks: block.familyLinks,
    bounds: boundsOf(nodes),
    ...relativeCounts(index, families, drawn, echoed, collapsed, nodes),
  };
}
