/**
 * Layered layout of the whole family network (the "Everyone" view).
 *
 * Unlike the focus view (focusLayout.ts), this draws every person exactly once
 * with every line, so very tangled families can have crossings.
 *
 * 1. Assign generations: parents one row above, children one row below,
 *    partners on the same row; unconnected groups are placed side by side.
 * 2. Group partners into clusters (a person with several partners sits in the
 *    middle), order clusters with barycentre sweeps to reduce crossings.
 * 3. Assign x coordinates by repeatedly pulling clusters towards their parents
 *    and children while keeping a minimum gap (isotonic regression).
 */
import type { TreeIndex } from '../model/relatives';
import type { Id, Partnership } from '../model/types';
import { buildFamilies } from './families';
import { relativeCounts } from './counts';
import {
  boundsOf,
  NODE_WIDTH,
  ROW_HEIGHT,
  type FamilyLink,
  type LayoutNode,
  type PartnerLink,
  type TreeLayout,
} from './types';

const PARTNER_GAP = 36;
const CLUSTER_GAP = 40;
const COMPONENT_GAP = 120;
const TRANSPOSE_LIMIT = 400;

/** Number of crossing pairs among straight lines between two rows (inversions), in O(n log n). */
export function countInversions(edges: [number, number][]): number {
  const sorted = [...edges].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const values = [...new Set(sorted.map((e) => e[1]))].sort((a, b) => a - b);
  const rank = new Map(values.map((v, i) => [v, i + 1]));
  const tree = new Array<number>(values.length + 1).fill(0);
  let inversions = 0;
  let seen = 0;
  // Lines sharing a start point do not cross each other.
  let groupStart = 0;
  const pending: number[] = [];
  const flush = () => {
    for (const r of pending) for (let i = r; i < tree.length; i += i & -i) tree[i]!++;
    seen += pending.length;
    pending.length = 0;
  };
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]![0] !== sorted[groupStart]![0]) {
      flush();
      groupStart = i;
    }
    const r = rank.get(sorted[i]![1])!;
    // Earlier lines ending strictly to the right of this one cross it.
    let notGreater = 0;
    for (let j = r; j > 0; j -= j & -j) notGreater += tree[j]!;
    inversions += seen - notGreater;
    pending.push(r);
  }
  return inversions;
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

/** Everyone connected to `startId`, with their generation; children of collapsed families are left out. */
function selectPeople(index: TreeIndex, startId: Id, isHidden: (child: Id) => boolean): Map<Id, number> {
  const generation = new Map<Id, number>([[startId, 0]]);
  const distance = new Map<Id, number>([[startId, 0]]);
  const deque: Id[] = [startId];
  while (deque.length) {
    const id = deque.shift()!;
    const d = distance.get(id)!;
    for (const n of neighbours(index, id)) {
      if (!index.people.has(n.id)) continue;
      if (n.delta === 1 && isHidden(n.id)) continue;
      const cost = n.delta === 0 ? 0 : 1;
      const nd = d + cost;
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

export function layoutNetwork(
  index: TreeIndex,
  focusId: Id | undefined,
  options: { collapsed?: ReadonlySet<string> } = {},
): TreeLayout {
  const collapsed = options.collapsed ?? new Set<string>();
  const families = buildFamilies(index);
  const hiddenChild = (child: Id) => collapsed.has(families.childFamily.get(child) ?? '');
  const empty: TreeLayout = {
    nodes: [],
    partnerLinks: [],
    familyLinks: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    hiddenRelatives: new Map(),
    collapsedFamilies: [],
  };
  if (index.people.size === 0) return empty;

  // --- 1 & 2: selection and generations -----------------------------------
  const generation = new Map<Id, number>();
  const components: Id[][] = [];
  const addComponent = (startId: Id) => {
    const selected = selectPeople(index, startId, hiddenChild);
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
  addComponent(start);
  // Descendants of collapsed families stay hidden even though they are "connected".
  const hiddenByCollapse = new Set<Id>();
  for (const key of collapsed) {
    const stack = [...(families.families.get(key)?.children ?? [])];
    while (stack.length) {
      const c = stack.pop()!;
      if (hiddenByCollapse.has(c) || generation.has(c)) continue;
      hiddenByCollapse.add(c);
      stack.push(...(index.linksByParent.get(c) ?? []).map((l) => l.childId));
    }
  }
  for (const p of index.tree.people) if (!generation.has(p.id) && !hiddenByCollapse.has(p.id)) addComponent(p.id);

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

    /** A couple from two families: each partner goes on the side of their own parents. */
    const orientCouples = () => {
      const positions = positionMap();
      for (const c of clusters) {
        if (c.members.length !== 2) continue;
        const [a, b] = c.members as [Id, Id];
        const ax = parentXs({ ...c, members: [a] }, positions);
        const bx = parentXs({ ...c, members: [b] }, positions);
        if (ax.length && bx.length && mean(ax) > mean(bx)) {
          const oa = c.offsets.get(a)!;
          c.offsets.set(a, c.offsets.get(b)!);
          c.offsets.set(b, oa);
          c.members = [b, a];
        }
      }
    };

    /** Number of crossing parent–child lines, the quantity the ordering tries to minimise. */
    const crossings = () => {
      const positions = positionMap();
      const at = (id: Id) => {
        const c = clusterOf.get(id)!;
        return positions.get(c)! + c.offsets.get(id)!;
      };
      let total = 0;
      for (const g of gens) {
        const edges: [number, number][] = [];
        for (const c of componentRows.get(g)!) {
          for (const m of c.members) {
            for (const l of index.linksByParent.get(m) ?? []) {
              const child = clusterOf.get(l.childId);
              if (child && child.generation === g + 1 && ids.includes(l.childId)) edges.push([at(m), at(l.childId)]);
            }
          }
        }
        total += countInversions(edges);
      }
      return total;
    };

    /** Swaps neighbouring clusters wherever that reduces crossings (a standard refinement step). */
    const transpose = () => {
      // Quadratic in the number of clusters, so only used for moderately sized families.
      if (clusters.length > TRANSPOSE_LIMIT) return;
      let current = crossings();
      for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (const g of gens) {
          const row = componentRows.get(g)!;
          for (let i = 0; i + 1 < row.length; i++) {
            [row[i], row[i + 1]] = [row[i + 1]!, row[i]!];
            packRow(row);
            const count = crossings();
            if (count < current) {
              current = count;
              improved = true;
            } else {
              [row[i], row[i + 1]] = [row[i + 1]!, row[i]!];
              packRow(row);
            }
          }
        }
        if (!improved) break;
      }
    };

    // Barycentre ordering sweeps (down, up, …, ending with a downward sweep so
    // siblings stay grouped under their parents), keeping the best ordering seen.
    let best = { crossings: Infinity, order: new Map<number, Cluster[]>(), offsets: new Map<Cluster, Map<Id, number>>() };
    const remember = () => {
      const count = crossings();
      if (count < best.crossings) {
        best = {
          crossings: count,
          order: new Map([...componentRows].map(([g, row]) => [g, [...row]])),
          offsets: new Map(clusters.map((c) => [c, new Map(c.offsets)])),
        };
      }
    };
    orientCouples();
    remember();
    for (let iteration = 0; iteration < 7; iteration++) {
      const down = iteration % 2 === 0;
      const sweep = down ? gens : [...gens].reverse();
      for (const g of sweep) {
        const row = componentRows.get(g)!;
        const positions = positionMap();
        const key = new Map(
          row.map((c) => {
            const xs = down ? parentXs(c, positions) : childXs(c, positions);
            return [c, xs.length ? mean(xs) : c.x] as const;
          }),
        );
        row.sort((a, b) => key.get(a)! - key.get(b)!);
        packRow(row);
      }
      orientCouples();
      for (const g of gens) packRow(componentRows.get(g)!);
      transpose();
      remember();
    }
    for (const [g, row] of best.order) componentRows.set(g, row);
    for (const [c, offsets] of best.offsets) {
      c.offsets = offsets;
      c.members = [...offsets.keys()].sort((a, b) => offsets.get(a)! - offsets.get(b)!);
    }
    for (const g of gens) packRow(componentRows.get(g)!);

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
      nodes.push({ key: m, person: index.people.get(m)!, x, y, generation: c.generation });
    }
  }

  // --- 5: links (drawn by routing.ts) ----------------------------------------------
  const rowOrder = new Map<number, Id[]>();
  for (const n of [...nodes].sort((a, b) => a.x - b.x)) {
    const list = rowOrder.get(n.generation) ?? [];
    list.push(n.person.id);
    rowOrder.set(n.generation, list);
  }
  const sideBySide = (a: Id, b: Id) => {
    const ga = generation.get(a);
    if (ga === undefined || ga !== generation.get(b)) return false;
    const row = rowOrder.get(ga)!;
    return Math.abs(row.indexOf(a) - row.indexOf(b)) === 1;
  };

  const partnerLinks: PartnerLink[] = [];
  for (const p of index.tree.partnerships) {
    if (!pos.has(p.partnerIds[0]) || !pos.has(p.partnerIds[1])) continue;
    partnerLinks.push({ key: p.id, a: p.partnerIds[0], b: p.partnerIds[1], ended: isEnded(p), adjacent: sideBySide(...p.partnerIds) });
  }

  const familyLinks: FamilyLink[] = [];
  for (const family of families.families.values()) {
    const parents = family.parents.filter((id) => pos.has(id));
    const children = family.children.filter((id) => pos.has(id));
    if (!parents.length || !children.length) continue;
    const joined = parents.length > 1 && parents.every((p, i) => i === 0 || sideBySide(parents[i - 1]!, p));
    familyLinks.push({
      key: family.key,
      parents,
      children: children.map((id) => ({ key: id, dashed: family.dashed.get(id) ?? false })),
      joined,
    });
  }

  const drawn = new Set(pos.keys());
  return {
    nodes,
    partnerLinks,
    familyLinks,
    bounds: boundsOf(nodes),
    ...relativeCounts(index, families, drawn, new Set(), collapsed, nodes),
  };
}

function isEnded(p: Partnership): boolean {
  return !!p.end && (p.end.reason !== undefined || !!p.end.date);
}
