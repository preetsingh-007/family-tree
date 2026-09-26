/**
 * Layered ("generational") layout for the visual tree.
 *
 * 1. Select the people within `radius` family steps of the focus person
 *    (parent/child = 1 step; partners are always shown together = 0 steps).
 * 2. Assign generations: parents one row above, children one row below,
 *    partners on the same row.
 * 3. Group partners into clusters (a person with several partners sits in the
 *    middle), order clusters with barycentre sweeps to reduce crossings.
 * 4. Assign x coordinates by repeatedly pulling clusters towards their parents
 *    and children while keeping a minimum gap (isotonic regression).
 * 5. Emit node positions and SVG paths for partnerships and parent → child lines.
 *
 * This is a pure function of the tree so it can be unit-tested without a DOM.
 */
import type { TreeIndex } from '../model/relatives';
import type { Id, ParentLinkKind, Partnership, Person } from '../model/types';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
const PARTNER_GAP = 36;
const CLUSTER_GAP = 40;
const ROW_HEIGHT = 150;
const COMPONENT_GAP = 120;

export interface LayoutOptions {
  /** Family steps from the focus person; Infinity shows everyone. */
  radius: number;
}

export interface LayoutNode {
  person: Person;
  x: number;
  y: number;
  generation: number;
}

export interface LayoutPartnerEdge {
  id: Id;
  path: string;
  ended: boolean;
}

export interface LayoutChildEdge {
  key: string;
  path: string;
  /** Adoptive, step, foster, or guardian relationships are drawn dashed. */
  dashed: boolean;
}

export interface TreeLayout {
  nodes: LayoutNode[];
  partnerEdges: LayoutPartnerEdge[];
  childEdges: LayoutChildEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** People outside the radius who are directly related to someone shown. */
  hiddenRelatives: Map<Id, number>;
}

interface Neighbour {
  id: Id;
  delta: -1 | 0 | 1;
}

function neighbours(index: TreeIndex, id: Id): Neighbour[] {
  const result: Neighbour[] = [];
  for (const p of index.partnershipsByPerson.get(id) ?? []) {
    result.push({ id: p.partnerIds[0] === id ? p.partnerIds[1] : p.partnerIds[0], delta: 0 });
  }
  for (const l of index.linksByChild.get(id) ?? []) result.push({ id: l.parentId, delta: -1 });
  for (const l of index.linksByParent.get(id) ?? []) result.push({ id: l.childId, delta: 1 });
  return result;
}

/** 0-1 BFS: partner edges cost 0, parent/child edges cost 1. */
function selectPeople(index: TreeIndex, focusId: Id, radius: number): Map<Id, number> {
  const generation = new Map<Id, number>([[focusId, 0]]);
  const distance = new Map<Id, number>([[focusId, 0]]);
  const deque: Id[] = [focusId];
  while (deque.length) {
    const id = deque.shift()!;
    const d = distance.get(id)!;
    for (const n of neighbours(index, id)) {
      if (!index.people.has(n.id)) continue;
      const cost = n.delta === 0 ? 0 : 1;
      const nd = d + cost;
      if (nd > radius) continue;
      const known = distance.get(n.id);
      if (known !== undefined && known <= nd) continue;
      distance.set(n.id, nd);
      if (!generation.has(n.id)) generation.set(n.id, generation.get(id)! + n.delta);
      if (cost === 0) deque.unshift(n.id);
      else deque.push(n.id);
    }
  }
  return generation;
}

interface Cluster {
  members: Id[];
  generation: number;
  /** Centre x of the cluster. */
  x: number;
  width: number;
  /** x of each member relative to the cluster centre. */
  offsets: Map<Id, number>;
}

function buildClusters(index: TreeIndex, ids: Id[], generation: Map<Id, number>): Cluster[] {
  const assigned = new Set<Id>();
  const clusters: Cluster[] = [];
  const partnersInRow = (id: Id) =>
    (index.partnershipsByPerson.get(id) ?? [])
      .slice()
      .sort((a, b) => (a.start?.date?.year ?? Infinity) - (b.start?.date?.year ?? Infinity))
      .map((p) => (p.partnerIds[0] === id ? p.partnerIds[1] : p.partnerIds[0]))
      .filter((pid, i, arr) => generation.get(pid) === generation.get(id) && arr.indexOf(pid) === i);

  for (const start of ids) {
    if (assigned.has(start)) continue;
    // Collect the connected component of partners in this row.
    const component: Id[] = [];
    const stack = [start];
    const seen = new Set<Id>([start]);
    while (stack.length) {
      const id = stack.pop()!;
      component.push(id);
      for (const pid of partnersInRow(id)) {
        if (!seen.has(pid) && !assigned.has(pid)) {
          seen.add(pid);
          stack.push(pid);
        }
      }
    }
    // Put the person with the most partners in the middle, alternating partners left/right.
    const hub = component.reduce((best, id) => (partnersInRow(id).length > partnersInRow(best).length ? id : best), component[0]!);
    const order: Id[] = [hub];
    const placed = new Set<Id>([hub]);
    partnersInRow(hub).forEach((pid, i) => {
      if (!seen.has(pid) || placed.has(pid)) return;
      placed.add(pid);
      if (i % 2 === 0) order.push(pid);
      else order.unshift(pid);
    });
    // Any remaining members (partners of partners) go next to whoever they are connected to, on the outside.
    let progress = true;
    while (placed.size < component.length && progress) {
      progress = false;
      for (const id of component) {
        if (placed.has(id)) continue;
        const anchor = partnersInRow(id).find((pid) => placed.has(pid));
        if (anchor === undefined) continue;
        const pos = order.indexOf(anchor);
        if (pos < order.length / 2) order.unshift(id);
        else order.push(id);
        placed.add(id);
        progress = true;
      }
    }
    const offsets = new Map<Id, number>();
    const width = order.length * NODE_WIDTH + (order.length - 1) * PARTNER_GAP;
    order.forEach((id, i) => {
      offsets.set(id, -width / 2 + NODE_WIDTH / 2 + i * (NODE_WIDTH + PARTNER_GAP));
      assigned.add(id);
    });
    clusters.push({ members: order, generation: generation.get(start)!, x: 0, width, offsets });
  }
  return clusters;
}

/**
 * Minimises Σ(xᵢ − desiredᵢ)² subject to clusters keeping their order and a
 * minimum gap, using the pool-adjacent-violators algorithm.
 */
function placeRow(row: Cluster[], desired: number[]): void {
  if (row.length === 0) return;
  const offsets: number[] = [0];
  for (let i = 1; i < row.length; i++) {
    offsets.push(offsets[i - 1]! + row[i - 1]!.width / 2 + CLUSTER_GAP + row[i]!.width / 2);
  }
  const blocks: { sum: number; count: number }[] = [];
  desired.forEach((d, i) => {
    blocks.push({ sum: d - offsets[i]!, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count <= last.sum / last.count) break;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  });
  let i = 0;
  for (const block of blocks) {
    const value = block.sum / block.count;
    for (let k = 0; k < block.count; k++, i++) row[i]!.x = value + offsets[i]!;
  }
}

export function layoutTree(index: TreeIndex, focusId: Id | undefined, options: LayoutOptions): TreeLayout {
  const empty: TreeLayout = {
    nodes: [],
    partnerEdges: [],
    childEdges: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    hiddenRelatives: new Map(),
  };
  if (index.people.size === 0) return empty;

  // --- 1 & 2: selection and generations -----------------------------------
  const generation = new Map<Id, number>();
  const components: Id[][] = [];
  const addComponent = (startId: Id, radius: number) => {
    const selected = selectPeople(index, startId, radius);
    const ids: Id[] = [];
    for (const [id, gen] of selected) {
      if (!generation.has(id)) {
        generation.set(id, gen);
        ids.push(id);
      }
    }
    components.push(ids);
  };

  const start = focusId && index.people.has(focusId) ? focusId : index.tree.people[0]!.id;
  addComponent(start, options.radius);
  if (!Number.isFinite(options.radius)) {
    for (const p of index.tree.people) if (!generation.has(p.id)) addComponent(p.id, Infinity);
  }

  // --- 3: clusters and ordering, per component --------------------------------
  const clusterOf = new Map<Id, Cluster>();
  let componentOffset = 0;
  const allClusters: Cluster[] = [];

  for (const ids of components) {
    const clusters = buildClusters(index, ids, generation);
    const componentRows = new Map<number, Cluster[]>();
    for (const c of clusters) {
      c.members.forEach((m) => clusterOf.set(m, c));
      const list = componentRows.get(c.generation);
      if (list) list.push(c);
      else componentRows.set(c.generation, [c]);
    }
    const gens = [...componentRows.keys()].sort((a, b) => a - b);
    const parentXs = (c: Cluster, positions: Map<Cluster, number>) => {
      const xs: number[] = [];
      for (const m of c.members) {
        for (const l of index.linksByChild.get(m) ?? []) {
          const pc = clusterOf.get(l.parentId);
          if (pc && positions.has(pc)) xs.push(positions.get(pc)! + pc.offsets.get(l.parentId)!);
        }
      }
      return xs;
    };
    const childXs = (c: Cluster, positions: Map<Cluster, number>) => {
      const xs: number[] = [];
      for (const m of c.members) {
        for (const l of index.linksByParent.get(m) ?? []) {
          const cc = clusterOf.get(l.childId);
          if (cc && positions.has(cc)) xs.push(positions.get(cc)! + cc.offsets.get(l.childId)!);
        }
      }
      return xs;
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    const packRow = (row: Cluster[]) => {
      let cursor = 0;
      for (const c of row) {
        c.x = cursor + c.width / 2;
        cursor += c.width + CLUSTER_GAP;
      }
    };
    for (const g of gens) packRow(componentRows.get(g)!);

    const positionMap = () => new Map(clusters.map((c) => [c, c.x] as const));
    // Barycentre ordering sweeps.
    for (let iteration = 0; iteration < 4; iteration++) {
      const sweep = iteration % 2 === 0 ? gens : [...gens].reverse();
      for (const g of sweep) {
        const row = componentRows.get(g)!;
        const positions = positionMap();
        const key = new Map(
          row.map((c) => {
            const xs = iteration % 2 === 0 ? parentXs(c, positions) : childXs(c, positions);
            return [c, xs.length ? mean(xs) : c.x] as const;
          }),
        );
        row.sort((a, b) => key.get(a)! - key.get(b)!);
        packRow(row);
      }
    }

    // --- 4: coordinate assignment ---------------------------------------------
    const desiredFor = (c: Cluster, useParents: boolean, useChildren: boolean, positions: Map<Cluster, number>) => {
      const targets: number[] = [];
      for (const m of c.members) {
        const off = c.offsets.get(m)!;
        if (useParents) {
          const xs = parentXs({ ...c, members: [m] }, positions);
          if (xs.length) targets.push(mean(xs) - off);
        }
      }
      if (useChildren) {
        const xs = childXs(c, positions);
        if (xs.length) targets.push(mean(xs));
      }
      return targets.length ? mean(targets) : c.x;
    };
    for (let iteration = 0; iteration < 8; iteration++) {
      const down = iteration % 2 === 0;
      const sweep = down ? gens : [...gens].reverse();
      for (const g of sweep) {
        const row = componentRows.get(g)!;
        const positions = positionMap();
        placeRow(row, row.map((c) => desiredFor(c, down || iteration > 5, !down || iteration > 5, positions)));
      }
    }

    // Shift the component to the right of the previous one.
    const minX = Math.min(...clusters.map((c) => c.x - c.width / 2));
    const maxX = Math.max(...clusters.map((c) => c.x + c.width / 2));
    const shift = componentOffset - minX;
    for (const c of clusters) {
      c.x += shift;
      allClusters.push(c);
    }
    componentOffset += maxX - minX + COMPONENT_GAP;
  }

  // Centre the focus person at x = 0 for a stable view.
  const focusCluster = clusterOf.get(start)!;
  const focusX = focusCluster.x + focusCluster.offsets.get(start)!;

  const nodes: LayoutNode[] = [];
  const pos = new Map<Id, { x: number; y: number }>();
  for (const c of allClusters) {
    for (const m of c.members) {
      const x = c.x + c.offsets.get(m)! - focusX;
      const y = c.generation * ROW_HEIGHT;
      pos.set(m, { x, y });
      nodes.push({ person: index.people.get(m)!, x, y, generation: c.generation });
    }
  }

  // --- 5: edges ---------------------------------------------------------------
  const partnerEdges: LayoutPartnerEdge[] = [];
  const drawnPartnerships = new Set<Id>();
  for (const p of index.tree.partnerships) {
    const a = pos.get(p.partnerIds[0]);
    const b = pos.get(p.partnerIds[1]);
    if (!a || !b || drawnPartnerships.has(p.id)) continue;
    drawnPartnerships.add(p.id);
    partnerEdges.push({ id: p.id, path: partnerPath(a, b), ended: isEnded(p) });
  }

  const childEdges: LayoutChildEdge[] = [];
  const groups = new Map<string, { parents: Id[]; children: { id: Id; kinds: ParentLinkKind[] }[] }>();
  for (const node of nodes) {
    const links = (index.linksByChild.get(node.person.id) ?? []).filter((l) => pos.has(l.parentId));
    if (!links.length) continue;
    const parents = links.map((l) => l.parentId).sort();
    const key = parents.join('|');
    let group = groups.get(key);
    if (!group) {
      group = { parents, children: [] };
      groups.set(key, group);
    }
    group.children.push({ id: node.person.id, kinds: links.map((l) => l.kind) });
  }
  const busCountPerRow = new Map<number, number>();
  for (const [key, group] of groups) {
    const parentPos = group.parents.map((id) => pos.get(id)!);
    const anchorX = parentPos.reduce((s, p) => s + p.x, 0) / parentPos.length;
    const lowestParentY = Math.max(...parentPos.map((p) => p.y));
    const adjacentCouple =
      parentPos.length === 2 && parentPos[0]!.y === parentPos[1]!.y && Math.abs(parentPos[0]!.x - parentPos[1]!.x) <= NODE_WIDTH + PARTNER_GAP + 1;
    const anchorY = adjacentCouple ? lowestParentY : lowestParentY + NODE_HEIGHT / 2;
    for (const child of group.children) {
      const c = pos.get(child.id)!;
      const dashed = child.kinds.some((k) => k !== 'biological' && k !== 'unknown');
      const childTop = c.y - NODE_HEIGHT / 2;
      let path: string;
      if (childTop > anchorY) {
        const row = Math.round(c.y / ROW_HEIGHT);
        const slotKey = row * 1000 + Math.round(anchorX);
        if (!busCountPerRow.has(slotKey)) busCountPerRow.set(slotKey, busCountPerRow.size % 3);
        const busY = childTop - 22 - busCountPerRow.get(slotKey)! * 6;
        path = `M${anchorX},${anchorY}V${busY}H${c.x}V${childTop}`;
      } else {
        path = `M${anchorX},${anchorY}L${c.x},${childTop}`;
      }
      childEdges.push({ key: `${key}>${child.id}`, path, dashed });
    }
  }

  // Relatives not shown, so the UI can indicate that the tree continues.
  const hiddenRelatives = new Map<Id, number>();
  for (const id of pos.keys()) {
    const hidden = neighbours(index, id).filter((n) => !pos.has(n.id)).length;
    if (hidden) hiddenRelatives.set(id, hidden);
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    nodes,
    partnerEdges,
    childEdges,
    hiddenRelatives,
    bounds: {
      minX: Math.min(...xs) - NODE_WIDTH / 2,
      maxX: Math.max(...xs) + NODE_WIDTH / 2,
      minY: Math.min(...ys) - NODE_HEIGHT / 2 - 30,
      maxY: Math.max(...ys) + NODE_HEIGHT / 2,
    },
  };
}

function isEnded(p: Partnership): boolean {
  return !!p.end && (p.end.reason !== undefined || !!p.end.date);
}

function partnerPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  if (left.y === right.y && right.x - left.x <= NODE_WIDTH + PARTNER_GAP + 1) {
    return `M${left.x + NODE_WIDTH / 2},${left.y}H${right.x - NODE_WIDTH / 2}`;
  }
  if (left.y === right.y) {
    // Not adjacent: arc above the row so the line does not pass through other people.
    const top = left.y - NODE_HEIGHT / 2;
    const lift = Math.min(60, 20 + (right.x - left.x) / 20);
    return `M${left.x},${top}C${left.x},${top - lift} ${right.x},${top - lift} ${right.x},${top}`;
  }
  return `M${left.x},${left.y}L${right.x},${right.y}`;
}
