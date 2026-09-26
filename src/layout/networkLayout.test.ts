import { describe, expect, it } from 'vitest';
import { buildIndex } from '../model/relatives';
import { addParentLink, addPartnership, addPerson, createEmptyTree } from '../model/tree';
import type { FamilyTreeDocument } from '../model/types';
import { complexFamily, person } from '../test/fixtures';
import { layoutNetwork } from './networkLayout';
import { NODE_WIDTH, type TreeLayout } from './types';

function expectNoOverlaps(layout: TreeLayout) {
  const rows = new Map<number, number[]>();
  for (const n of layout.nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n.x]);
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_WIDTH);
  }
}

describe('network layout ("Everyone")', () => {
  it('handles an empty tree', () => {
    expect(layoutNetwork(buildIndex(createEmptyTree('T')), undefined).nodes).toEqual([]);
  });

  it('places generations in rows and partners side by side', () => {
    const f = complexFamily();
    const layout = layoutNetwork(buildIndex(f.tree), f.ed.id);
    const node = (id: string) => layout.nodes.find((n) => n.person.id === id)!;

    expect(layout.nodes).toHaveLength(f.tree.people.length);
    expect(node(f.arthur.id).y).toBeLessThan(node(f.ed.id).y);
    expect(node(f.ed.id).y).toBeLessThan(node(f.hana.id).y);
    expect(node(f.ed.id).y).toBe(node(f.gina.id).y);
    expect(Math.abs(node(f.ed.id).x - node(f.gina.id).x)).toBeLessThan(NODE_WIDTH * 1.5);
    expect(node(f.ed.id).x).toBe(0);
    expectNoOverlaps(layout);
  });

  it('links every partnership and every child to its parents', () => {
    const f = complexFamily();
    const layout = layoutNetwork(buildIndex(f.tree), f.arthur.id);
    expect(layout.partnerLinks).toHaveLength(f.tree.partnerships.length);
    const childrenLinked = layout.familyLinks.flatMap((l) => l.children.map((c) => c.key));
    expect(new Set(childrenLinked)).toEqual(new Set(f.tree.parentLinks.map((l) => l.childId)));
    const hana = layout.familyLinks.find((l) => l.children.some((c) => c.key === f.hana.id))!;
    expect(hana.children.find((c) => c.key === f.hana.id)!.dashed).toBe(true);
    expect(layout.partnerLinks.find((l) => l.key === 'p-ab')!.ended).toBe(true);
  });

  it('places a person with several partners between them', () => {
    const f = complexFamily();
    const layout = layoutNetwork(buildIndex(f.tree), f.arthur.id);
    const x = (id: string) => layout.nodes.find((n) => n.person.id === id)!.x;
    const [left, right] = [x(f.beatrice.id), x(f.clara.id)].sort((a, b) => a - b);
    expect(x(f.arthur.id)).toBeGreaterThan(left!);
    expect(x(f.arthur.id)).toBeLessThan(right!);
  });

  it('shows disconnected people, and hides the descendants of collapsed people', () => {
    const f = complexFamily();
    const loner = person('Solo', 'Unlinked');
    const tree = addPerson(f.tree, loner);
    const all = layoutNetwork(buildIndex(tree), f.arthur.id);
    expect(all.nodes.some((n) => n.person.id === loner.id)).toBe(true);
    expectNoOverlaps(all);

    const edAndGina = [f.ed.id, f.gina.id].sort().join('|');
    const collapsed = layoutNetwork(buildIndex(tree), f.arthur.id, { collapsed: new Set([edAndGina]) });
    expect(collapsed.nodes.some((n) => n.person.id === f.hana.id)).toBe(false);
    expect(collapsed.collapsedFamilies).toMatchObject([{ key: edAndGina, hidden: 1 }]);
  });

  it('copes with large families and many partners without overlaps', () => {
    let tree: FamilyTreeDocument = createEmptyTree('Big');
    const root = person('Root', 'Big');
    tree = addPerson(tree, root);
    for (let p = 0; p < 4; p++) {
      const partner = person(`Partner${p}`, 'Big');
      tree = addPartnership(addPerson(tree, partner), root.id, partner.id);
      for (let c = 0; c < 6; c++) {
        const child = person(`Child${p}-${c}`, 'Big');
        tree = addParentLink(addParentLink(addPerson(tree, child), root.id, child.id), partner.id, child.id);
        for (let g = 0; g < 3; g++) {
          const grandchild = person(`Grand${p}-${c}-${g}`, 'Big');
          tree = addParentLink(addPerson(tree, grandchild), child.id, grandchild.id);
        }
      }
    }
    const start = performance.now();
    const layout = layoutNetwork(buildIndex(tree), root.id);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(layout.nodes).toHaveLength(tree.people.length);
    expectNoOverlaps(layout);
  });
});

describe('crossing count', () => {
  it('counts crossing lines between rows', async () => {
    const { countInversions } = await import('./networkLayout');
    expect(countInversions([])).toBe(0);
    expect(countInversions([[0, 0], [1, 1]])).toBe(0);
    expect(countInversions([[0, 1], [1, 0]])).toBe(1);
    // Lines from the same parent, or to the same child, never cross.
    expect(countInversions([[0, 0], [0, 1], [1, 1]])).toBe(0);
    expect(countInversions([[0, 2], [1, 1], [2, 0]])).toBe(3);
    const random = Array.from({ length: 60 }, (_, i) => [i % 7, (i * 13) % 11] as [number, number]);
    let brute = 0;
    for (let i = 0; i < random.length; i++)
      for (let j = i + 1; j < random.length; j++) if ((random[i]![0] - random[j]![0]) * (random[i]![1] - random[j]![1]) < 0) brute++;
    expect(countInversions(random)).toBe(brute);
  });
});
