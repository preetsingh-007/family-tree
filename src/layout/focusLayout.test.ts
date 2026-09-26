import { describe, expect, it } from 'vitest';
import { buildIndex } from '../model/relatives';
import { addParentLink, addPartnership, addPerson, createEmptyTree } from '../model/tree';
import type { FamilyTreeDocument, Id } from '../model/types';
import { complexFamily, person } from '../test/fixtures';
import { randomFamily, rng } from '../test/randomFamily';
import { findLayoutProblems } from './check';
import { layoutFocus } from './focusLayout';
import { NODE_WIDTH, type TreeLayout } from './types';

function build(spec: { people: string[]; couples?: [string, string][]; children?: [string[], string][] }) {
  let tree: FamilyTreeDocument = createEmptyTree('Spec');
  const ids = new Map<string, Id>();
  for (const name of spec.people) {
    const p = person(name, 'Spec');
    ids.set(name, p.id);
    tree = addPerson(tree, p);
  }
  for (const [a, b] of spec.couples ?? []) tree = addPartnership(tree, ids.get(a)!, ids.get(b)!);
  for (const [parents, c] of spec.children ?? []) for (const p of parents) tree = addParentLink(tree, ids.get(p)!, ids.get(c)!);
  return { index: buildIndex(tree), id: (name: string) => ids.get(name)! };
}

const drawn = (layout: TreeLayout) => layout.nodes.filter((n) => !n.echo).map((n) => n.person.givenNames).sort();
const node = (layout: TreeLayout, name: string) => layout.nodes.find((n) => !n.echo && n.person.givenNames === name)!;

/** The family from the reported screenshot: two families joined by one marriage, plus more. */
const joinedFamilies = {
  people: ['Inder', 'Manjit', 'Baldev', 'Usha', 'Manmohan', 'Gurcharan', 'Amarjit', 'Hardeep', 'Satinder', 'Kamaljit', 'Manpreet', 'Rajwinder', 'Sagalpreet', 'Prabalpreet'],
  couples: [
    ['Inder', 'Manjit'],
    ['Baldev', 'Usha'],
    ['Gurcharan', 'Hardeep'],
    ['Manpreet', 'Rajwinder'],
  ] as [string, string][],
  children: [
    [['Inder', 'Manjit'], 'Manmohan'],
    [['Inder', 'Manjit'], 'Gurcharan'],
    [['Inder', 'Manjit'], 'Amarjit'],
    [['Baldev', 'Usha'], 'Hardeep'],
    [['Baldev', 'Usha'], 'Satinder'],
    [['Baldev', 'Usha'], 'Kamaljit'],
    [['Baldev', 'Usha'], 'Manpreet'],
    [['Gurcharan', 'Hardeep'], 'Sagalpreet'],
    [['Gurcharan', 'Hardeep'], 'Prabalpreet'],
  ] as [string[], string][],
};

describe('focus layout', () => {
  it('draws two families joined by a marriage without any crossing', () => {
    const { index, id } = build(joinedFamilies);
    for (const radius of [2, 3, 4, 6]) {
      const layout = layoutFocus(index, id('Gurcharan'), { radius });
      expect(findLayoutProblems(layout)).toEqual([]);
    }
    const layout = layoutFocus(index, id('Gurcharan'), { radius: 3 });
    expect(drawn(layout)).toEqual([...joinedFamilies.people].sort());
    // The couple joining the families is side by side.
    expect(Math.abs(node(layout, 'Gurcharan').x - node(layout, 'Hardeep').x)).toBeLessThan(NODE_WIDTH * 1.5);
    // Generations are in rows: parents above, children below.
    expect(node(layout, 'Inder').y).toBeLessThan(node(layout, 'Gurcharan').y);
    expect(node(layout, 'Sagalpreet').y).toBeGreaterThan(node(layout, 'Gurcharan').y);
    expect(node(layout, 'Hardeep').y).toBe(node(layout, 'Gurcharan').y);
  });

  it('uses an echo box instead of a crossing when two brothers marry two sisters', () => {
    const { index, id } = build({
      people: ['PB1', 'PB2', 'PS1', 'PS2', 'B1', 'B2', 'S1', 'S2', 'C1', 'C2'],
      couples: [
        ['PB1', 'PB2'],
        ['PS1', 'PS2'],
        ['B1', 'S1'],
        ['B2', 'S2'],
      ],
      children: [
        [['PB1', 'PB2'], 'B1'],
        [['PB1', 'PB2'], 'B2'],
        [['PS1', 'PS2'], 'S1'],
        [['PS1', 'PS2'], 'S2'],
        [['B1', 'S1'], 'C1'],
        [['B2', 'S2'], 'C2'],
      ],
    });
    for (const focus of ['B1', 'S2', 'C1', 'PB1']) {
      const layout = layoutFocus(index, id(focus), { radius: 6 });
      expect(findLayoutProblems(layout)).toEqual([]);
      // Everyone appears (as a box or an echo): nothing is lost to avoid the crossing.
      const shown = new Set(layout.nodes.map((n) => n.person.givenNames));
      expect(shown.size).toBe(10);
      expect(layout.nodes.some((n) => n.echo)).toBe(true);
    }
  });

  it('handles cousin marriage, remarriage and adoption', () => {
    const { tree, arthur, clara, dora, ed, frank } = complexFamily();
    let t = tree;
    // Dora's daughter marries Frank's son (cousins... via half-siblings).
    const d1 = person('Dee', 'Testfield');
    const f1 = person('Fin', 'Testfield');
    t = addPerson(addPerson(t, d1), f1);
    t = addParentLink(addParentLink(t, dora.id, d1.id), frank.id, f1.id);
    t = addPartnership(t, d1.id, f1.id);
    const index = buildIndex(t);
    for (const focus of [arthur.id, clara.id, ed.id, d1.id, f1.id]) {
      for (const radius of [2, 3, 6]) {
        expect(findLayoutProblems(layoutFocus(index, focus, { radius }))).toEqual([]);
      }
    }
  });

  it('expands a person in place and collapses descendants', () => {
    // A chain of generations G0 … G6.
    let tree: FamilyTreeDocument = createEmptyTree('Chain');
    const people = Array.from({ length: 7 }, (_, i) => person(`G${i}`, 'Chain'));
    for (const p of people) tree = addPerson(tree, p);
    for (let i = 1; i < people.length; i++) tree = addParentLink(tree, people[i - 1]!.id, people[i]!.id);
    const index = buildIndex(tree);
    const focus = people[3]!.id;

    const base = layoutFocus(index, focus, { radius: 2 });
    expect(drawn(base)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    expect(base.hiddenRelatives.get(people[1]!.id)).toBe(1);

    // Expanding G1 shows G0 without losing anything already shown.
    const expanded = layoutFocus(index, focus, { radius: 2, expanded: new Set([people[1]!.id]) });
    expect(drawn(expanded)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5']);
    expect(expanded.hiddenRelatives.has(people[1]!.id)).toBe(false);

    // Collapsing G4's family hides G5 (and would hide everything below).
    const g4Family = [people[4]!.id].join('|');
    const collapsed = layoutFocus(index, focus, { radius: 6, collapsed: new Set([g4Family]) });
    expect(drawn(collapsed)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4']);
    expect(collapsed.collapsedFamilies).toEqual([{ key: g4Family, parents: [people[4]!.id], hidden: 2 }]);
    expect(collapsed.hiddenRelatives.has(people[4]!.id)).toBe(false);
  });

  it('never produces crossings or overlaps for random families', () => {
    let layouts = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { tree, people } = randomFamily(seed, 4 + (seed % 2));
      const index = buildIndex(tree);
      const random = rng(seed * 7);
      for (let k = 0; k < 3; k++) {
        const focus = people[Math.floor(random() * people.length)]!;
        const radius = [2, 3, 4, 6][Math.floor(random() * 4)]!;
        const layout = layoutFocus(index, focus, { radius });
        const problems = findLayoutProblems(layout);
        if (problems.length) throw new Error(`seed ${seed}, focus ${index.people.get(focus)!.givenNames}, radius ${radius}: ${JSON.stringify(problems.slice(0, 3))}`);
        layouts++;
      }
    }
    expect(layouts).toBe(360);
  });
});

describe('focus layout quality on realistic families', () => {
  it('shows nearly everyone in the close views, with no crossings', async () => {
    const { realisticFamily } = await import('../test/randomFamily');
    const coverage = new Map<number, [number, number]>();
    for (let seed = 1; seed <= 30; seed++) {
      const { tree, people } = realisticFamily(seed, 4);
      const index = buildIndex(tree);
      const random = rng(seed * 13);
      for (let k = 0; k < 3; k++) {
        const focus = people[Math.floor(random() * people.length)]!;
        for (const radius of [2, 3]) {
          const layout = layoutFocus(index, focus, { radius });
          expect(findLayoutProblems(layout)).toEqual([]);
          // Everyone within the radius (partners 0 steps, parents/children 1 step).
          const within = new Map([[focus, 0]]);
          const queue = [focus];
          while (queue.length) {
            const id = queue.shift()!;
            const d = within.get(id)!;
            const next = [
              ...(index.partnershipsByPerson.get(id) ?? []).map((p) => [p.partnerIds[0] === id ? p.partnerIds[1] : p.partnerIds[0], d] as const),
              ...(index.linksByChild.get(id) ?? []).map((l) => [l.parentId, d + 1] as const),
              ...(index.linksByParent.get(id) ?? []).map((l) => [l.childId, d + 1] as const),
            ];
            for (const [n, nd] of next) {
              if (nd > radius || (within.has(n) && within.get(n)! <= nd)) continue;
              within.set(n, nd);
              if (nd === d) queue.unshift(n);
              else queue.push(n);
            }
          }
          const shown = new Set(layout.nodes.map((n) => n.person.id));
          const acc = coverage.get(radius) ?? [0, 0];
          acc[0] += [...within.keys()].filter((id) => shown.has(id)).length;
          acc[1] += within.size;
          coverage.set(radius, acc);
          // The focus person's parents, partners and children are always shown.
          for (const id of [
            ...(index.linksByChild.get(focus) ?? []).map((l) => l.parentId),
            ...(index.linksByParent.get(focus) ?? []).map((l) => l.childId),
            ...(index.partnershipsByPerson.get(focus) ?? []).flatMap((p) => p.partnerIds),
          ]) {
            expect(shown.has(id)).toBe(true);
          }
        }
      }
    }
    const [c2, t2] = coverage.get(2)!;
    const [c3, t3] = coverage.get(3)!;
    expect(c2 / t2).toBeGreaterThan(0.95);
    expect(c3 / t3).toBeGreaterThan(0.88);
  });
});
