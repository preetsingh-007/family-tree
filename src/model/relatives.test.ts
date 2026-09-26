import { describe, expect, it } from 'vitest';
import { complexFamily } from '../test/fixtures';
import {
  buildIndex,
  getAssociations,
  getChildGroups,
  getChildren,
  getDerivedStepParents,
  getParents,
  getPartners,
  getSiblings,
} from './relatives';
import { addAssociation } from './tree';

describe('derived relationships', () => {
  const family = complexFamily();
  const index = buildIndex(family.tree);
  const names = (list: { person: { givenNames: string } }[]) => list.map((r) => r.person.givenNames);

  it('finds parents and children', () => {
    expect(names(getParents(index, family.dora.id)).sort()).toEqual(['Arthur', 'Beatrice']);
    expect(names(getChildren(index, family.arthur.id))).toEqual(['Dora', 'Ed', 'Frank']);
  });

  it('lists every partnership of a person', () => {
    expect(names(getPartners(index, family.arthur.id)).sort()).toEqual(['Beatrice', 'Clara']);
  });

  it('derives full, half and step siblings without stored sibling data', () => {
    const siblings = getSiblings(index, family.dora.id).map((s) => [s.person.givenNames, s.kind]);
    expect(siblings).toEqual(
      expect.arrayContaining([
        ['Ed', 'full'],
        ['Frank', 'half'],
        ['Ivo', 'step'],
      ]),
    );
    expect(siblings).toHaveLength(3);
    const ivoSiblings = getSiblings(index, family.ivo.id).map((s) => [s.person.givenNames, s.kind]);
    expect(ivoSiblings).toEqual(expect.arrayContaining([['Frank', 'half']]));
  });

  it('derives step-parents from a parent’s partners', () => {
    const stepParents = getDerivedStepParents(index, family.ivo.id);
    expect(stepParents.map((s) => [s.person.givenNames, s.via.givenNames])).toEqual([['Arthur', 'Clara']]);
    expect(names(getDerivedStepParents(index, family.dora.id))).toEqual(['Clara']);
  });

  it('keeps adoption visible in parent links', () => {
    expect(getParents(index, family.hana.id).map((p) => p.link.kind)).toEqual(['adoptive', 'adoptive']);
  });

  it('groups children by the other parent', () => {
    const groups = getChildGroups(index, family.arthur.id);
    const summary = groups.map((g) => [g.coParent?.givenNames, names(g.children)]);
    expect(summary).toEqual(
      expect.arrayContaining([
        ['Beatrice', ['Dora', 'Ed']],
        ['Clara', ['Frank']],
      ]),
    );
  });

  it('reports associations in both directions', () => {
    const tree = addAssociation(family.tree, family.gina.id, family.frank.id, 'godparent');
    const idx = buildIndex(tree);
    expect(getAssociations(idx, family.gina.id)[0]).toMatchObject({ outgoing: true });
    expect(getAssociations(idx, family.frank.id)[0]).toMatchObject({ outgoing: false });
  });
});
