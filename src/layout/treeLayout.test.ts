import { describe, expect, it } from 'vitest';
import { buildIndex } from '../model/relatives';
import { addParentLink, addPartnership, addPerson, createEmptyTree } from '../model/tree';
import type { FamilyTreeDocument } from '../model/types';
import { complexFamily, person } from '../test/fixtures';
import { layoutTree, NODE_WIDTH } from './treeLayout';

function expectNoOverlaps(layout: ReturnType<typeof layoutTree>) {
  const rows = new Map<number, number[]>();
  for (const n of layout.nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n.x]);
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_WIDTH);
  }
}

describe('tree layout', () => {
  it('handles an empty tree', () => {
    const layout = layoutTree(buildIndex(createEmptyTree('T')), undefined, { radius: 3 });
    expect(layout.nodes).toEqual([]);
  });

  it('places generations in rows and partners side by side', () => {
    const f = complexFamily();
    const layout = layoutTree(buildIndex(f.tree), f.ed.id, { radius: Infinity });
    const node = (id: string) => layout.nodes.find((n) => n.person.id === id)!;

    expect(layout.nodes).toHaveLength(f.tree.people.length);
    expect(node(f.arthur.id).y).toBeLessThan(node(f.ed.id).y);
    expect(node(f.ed.id).y).toBeLessThan(node(f.hana.id).y);
    expect(node(f.ed.id).y).toBe(node(f.gina.id).y);
    expect(node(f.ed.id).y).toBe(node(f.dora.id).y);
    expect(Math.abs(node(f.ed.id).x - node(f.gina.id).x)).toBeLessThan(NODE_WIDTH * 1.5);
    // The focus person is centred at the origin.
    expect(node(f.ed.id).x).toBe(0);
    expectNoOverlaps(layout);
  });

  it('draws every partnership and parent–child line among visible people', () => {
    const f = complexFamily();
    const layout = layoutTree(buildIndex(f.tree), f.arthur.id, { radius: Infinity });
    expect(layout.partnerEdges).toHaveLength(f.tree.partnerships.length);
    // One line per child (children sharing parents share a bus).
    const childrenWithParents = new Set(f.tree.parentLinks.map((l) => l.childId));
    expect(layout.childEdges).toHaveLength(childrenWithParents.size);
    // Adoption is drawn dashed; divorce drawn as ended.
    expect(layout.childEdges.find((e) => e.key.endsWith(f.hana.id))!.dashed).toBe(true);
    expect(layout.partnerEdges.find((e) => e.id === 'p-ab')!.ended).toBe(true);
  });

  it('places a person with several partners between them', () => {
    const f = complexFamily();
    const layout = layoutTree(buildIndex(f.tree), f.arthur.id, { radius: Infinity });
    const x = (id: string) => layout.nodes.find((n) => n.person.id === id)!.x;
    const [left, right] = [x(f.beatrice.id), x(f.clara.id)].sort((a, b) => a - b);
    expect(x(f.arthur.id)).toBeGreaterThan(left!);
    expect(x(f.arthur.id)).toBeLessThan(right!);
  });

  it('limits the view to nearby relatives and reports hidden ones', () => {
    // A chain of eight generations.
    let tree: FamilyTreeDocument = createEmptyTree('Chain');
    const people = Array.from({ length: 8 }, (_, i) => person(`G${i}`, 'Chain'));
    for (const p of people) tree = addPerson(tree, p);
    for (let i = 1; i < people.length; i++) tree = addParentLink(tree, people[i - 1]!.id, people[i]!.id);
    const layout = layoutTree(buildIndex(tree), people[4]!.id, { radius: 2 });
    expect(layout.nodes.map((n) => n.person.givenNames).sort()).toEqual(['G2', 'G3', 'G4', 'G5', 'G6']);
    expect(layout.hiddenRelatives.get(people[2]!.id)).toBe(1);
    expect(layout.hiddenRelatives.has(people[4]!.id)).toBe(false);
  });

  it('shows disconnected people when showing everyone', () => {
    const f = complexFamily();
    const loner = person('Solo', 'Unlinked');
    const tree = addPerson(f.tree, loner);
    expect(layoutTree(buildIndex(tree), f.arthur.id, { radius: 3 }).nodes.some((n) => n.person.id === loner.id)).toBe(false);
    const all = layoutTree(buildIndex(tree), f.arthur.id, { radius: Infinity });
    expect(all.nodes.some((n) => n.person.id === loner.id)).toBe(true);
    expectNoOverlaps(all);
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
    const layout = layoutTree(buildIndex(tree), root.id, { radius: Infinity });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(layout.nodes).toHaveLength(tree.people.length);
    expectNoOverlaps(layout);
  });
});
