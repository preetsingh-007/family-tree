import { describe, expect, it } from 'vitest';
import { buildIndex } from '../model/relatives';
import { createEmptyTree, createPerson } from '../model/tree';
import { findLayoutProblems, pathSegments, segmentsIntersect } from './check';
import { findOffset, Occupancy } from './occupancy';
import type { TreeLayout } from './types';

function layoutOf(nodes: [string, number, number][], partners: [string, string][] = [], families: [string[], string[]][] = []): TreeLayout {
  const people = nodes.map(([key]) => createPerson({ givenNames: key }));
  const tree = { ...createEmptyTree('Check'), people };
  buildIndex(tree);
  return {
    nodes: nodes.map(([key, x, y], i) => ({ key, person: people[i]!, x, y, generation: y / 150 })),
    partnerLinks: partners.map(([a, b], i) => ({ key: `p${i}`, a, b, ended: false, adjacent: true })),
    familyLinks: families.map(([parents, children], i) => ({
      key: `f${i}`,
      parents,
      children: children.map((key) => ({ key, dashed: false })),
      joined: parents.length > 1,
    })),
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    hiddenRelatives: new Map(),
    collapsedFamilies: [],
  };
}

describe('layout checker', () => {
  it('parses paths and intersects segments', () => {
    expect(pathSegments('M0,0V10H20')).toEqual([
      [{ x: 0, y: 0 }, { x: 0, y: 10 }],
      [{ x: 0, y: 10 }, { x: 20, y: 10 }],
    ]);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
  });

  it('accepts a clean family', () => {
    const layout = layoutOf([['A', 0, 0], ['B', 236, 0], ['C', 118, 150]], [['A', 'B']], [[['A', 'B'], ['C']]]);
    expect(findLayoutProblems(layout)).toEqual([]);
  });

  it('finds overlapping boxes, lines through boxes, and crossing lines', () => {
    expect(findLayoutProblems(layoutOf([['A', 0, 0], ['B', 50, 0]]))[0]!.kind).toBe('box-overlap');
    const crossing = layoutOf(
      [['P1', 0, 0], ['P2', 600, 0], ['C1', 600, 150], ['C2', 0, 150]],
      [],
      [
        [['P1'], ['C1']],
        [['P2'], ['C2']],
      ],
    );
    expect(findLayoutProblems(crossing).some((p) => p.kind === 'crossing')).toBe(true);
    const box = layoutOf([['P', 0, 0], ['C', 0, 300], ['M', 0, 150]], [], [[['P'], ['C']]]);
    expect(findLayoutProblems(box).some((p) => p.kind === 'line-through-box')).toBe(true);
  });
});

describe('occupancy', () => {
  it('merges intervals and detects conflicts with a margin', () => {
    const a = new Occupancy().add(0, 0, 10).add(0, 5, 20).add(0, 40, 50);
    expect(a.get(0)).toEqual([
      [0, 20],
      [40, 50],
    ]);
    expect(a.hits(0, 25, 30, 4)).toBe(false);
    expect(a.hits(0, 25, 30, 6)).toBe(true);
    const b = new Occupancy().add(0, 0, 10);
    expect(a.conflicts(b, 4, 26)).toBe(false);
    expect(a.conflicts(b, 4, 23)).toBe(true);
  });

  it('finds the closest free offset', () => {
    const base = new Occupancy().add(0, -100, 100);
    const add = new Occupancy().add(0, -100, 100);
    expect(findOffset(base, add, 20, 1)).toBe(220);
    expect(findOffset(base, add, 20, -10)).toBe(-220);
    expect(findOffset(base, add, 20, 0, { max: 0 })).toBe(-220);
    expect(findOffset(base, add, 20, 500)).toBe(500);
    expect(findOffset(base, add, 20, 0, { min: 0, max: 100 })).toBeUndefined();
  });
});
