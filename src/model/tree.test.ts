import { describe, expect, it } from 'vitest';
import { complexFamily, person } from '../test/fixtures';
import { validateTreeDocument } from './schema';
import {
  addAssociation,
  addMedia,
  addParentLink,
  addPartnership,
  addPerson,
  createEmptyTree,
  describePersonRemoval,
  removeMedia,
  removeParentLink,
  removePartnership,
  removePerson,
  setPortrait,
  TreeError,
  updateParentLink,
  updatePartnership,
  updatePerson,
} from './tree';
import type { MediaItem } from './types';

describe('people', () => {
  it('creates an empty, valid tree', () => {
    const tree = createEmptyTree('  My family  ');
    expect(tree.title).toBe('My family');
    expect(tree.people).toEqual([]);
    expect(validateTreeDocument(tree).ok).toBe(true);
  });

  it('adds, edits and deletes a person', () => {
    const alice = person('Alice', 'Example');
    let tree = addPerson(createEmptyTree('T'), alice);
    expect(tree.people).toHaveLength(1);

    tree = updatePerson(tree, { ...alice, givenNames: 'Alicia', notes: '# Hello' });
    expect(tree.people[0]).toMatchObject({ givenNames: 'Alicia', notes: '# Hello' });

    tree = removePerson(tree, alice.id);
    expect(tree.people).toHaveLength(0);
  });

  it('does not mutate the original document', () => {
    const tree = createEmptyTree('T');
    const next = addPerson(tree, person('A', 'B'));
    expect(tree.people).toHaveLength(0);
    expect(next).not.toBe(tree);
  });

  it('rejects duplicate identifiers and unknown people', () => {
    const alice = person('Alice', 'Example');
    const tree = addPerson(createEmptyTree('T'), alice);
    expect(() => addPerson(tree, alice)).toThrow(TreeError);
    expect(() => updatePerson(tree, person('Nobody', 'Here'))).toThrow(TreeError);
    expect(() => removePerson(tree, 'missing')).toThrow(TreeError);
  });

  it('removes all relationships and photos belonging to a deleted person', () => {
    const { tree, arthur, dora } = complexFamily();
    const summary = describePersonRemoval(tree, arthur.id);
    expect(summary).toMatchObject({ parentLinks: 3, partnerships: 2 });

    const next = removePerson(tree, arthur.id);
    expect(next.parentLinks.some((l) => l.parentId === arthur.id || l.childId === arthur.id)).toBe(false);
    expect(next.partnerships.some((p) => p.partnerIds.includes(arthur.id))).toBe(false);
    // Other people and their relationships remain.
    expect(next.people.find((p) => p.id === dora.id)).toBeDefined();
    expect(next.parentLinks.length).toBe(tree.parentLinks.length - 3);
    expect(validateTreeDocument(next).ok).toBe(true);
  });
});

describe('relationships', () => {
  it('creates and removes parent–child relationships', () => {
    const parent = person('P', 'X');
    const child = person('C', 'X');
    let tree = addPerson(addPerson(createEmptyTree('T'), parent), child);
    tree = addParentLink(tree, parent.id, child.id, 'biological', 'link-1');
    expect(tree.parentLinks).toEqual([{ id: 'link-1', parentId: parent.id, childId: child.id, kind: 'biological' }]);

    tree = updateParentLink(tree, { ...tree.parentLinks[0]!, kind: 'adoptive' });
    expect(tree.parentLinks[0]!.kind).toBe('adoptive');

    tree = removeParentLink(tree, 'link-1');
    expect(tree.parentLinks).toEqual([]);
  });

  it('prevents impossible parent relationships', () => {
    const a = person('A', 'X');
    const b = person('B', 'X');
    const c = person('C', 'X');
    let tree = [a, b, c].reduce(addPerson, createEmptyTree('T'));
    tree = addParentLink(tree, a.id, b.id);
    tree = addParentLink(tree, b.id, c.id);

    expect(() => addParentLink(tree, a.id, a.id)).toThrow(/own parent/);
    expect(() => addParentLink(tree, a.id, b.id)).toThrow(/already exists/);
    expect(() => addParentLink(tree, c.id, a.id)).toThrow(/own ancestor/);
    expect(() => addParentLink(tree, b.id, a.id)).toThrow(/own ancestor/);
    expect(() => addParentLink(tree, a.id, 'missing')).toThrow(TreeError);
  });

  it('does not allow a relationship edit to change who it connects', () => {
    const { tree, arthur, clara } = complexFamily();
    const link = tree.parentLinks[0]!;
    expect(() => updateParentLink(tree, { ...link, parentId: clara.id })).toThrow(TreeError);
    const partnership = tree.partnerships.find((p) => p.id === 'p-ab')!;
    expect(() => updatePartnership(tree, { ...partnership, partnerIds: [arthur.id, clara.id] })).toThrow(TreeError);
  });

  it('supports multiple partnerships, including remarrying the same person', () => {
    const a = person('A', 'X');
    const b = person('B', 'Y');
    let tree = addPerson(addPerson(createEmptyTree('T'), a), b);
    tree = addPartnership(tree, a.id, b.id, 'marriage', 'first');
    tree = updatePartnership(tree, { ...tree.partnerships[0]!, end: { reason: 'divorce', date: { qualifier: 'exact', year: 1970 } } });
    tree = addPartnership(tree, b.id, a.id, 'marriage', 'second');
    expect(tree.partnerships).toHaveLength(2);
    expect(() => addPartnership(tree, a.id, a.id)).toThrow(/own partner/);

    tree = removePartnership(tree, 'first');
    expect(tree.partnerships.map((p) => p.id)).toEqual(['second']);
    expect(validateTreeDocument(tree).ok).toBe(true);
  });

  it('records other relationships with a label', () => {
    const { tree, gina, frank } = complexFamily();
    const next = addAssociation(tree, gina.id, frank.id, ' godparent ');
    expect(next.associations[0]).toMatchObject({ personIds: [gina.id, frank.id], label: 'godparent' });
    expect(() => addAssociation(tree, gina.id, frank.id, '   ')).toThrow(TreeError);
    expect(() => addAssociation(tree, gina.id, gina.id, 'friend')).toThrow(TreeError);
  });
});

describe('media', () => {
  const photo = (id: string): MediaItem => ({ id, mimeType: 'image/jpeg', data: 'AAAA' });

  it('attaches photos to people and chooses a portrait', () => {
    const { tree, dora } = complexFamily();
    let next = addMedia(tree, dora.id, photo('m1'));
    next = addMedia(next, dora.id, photo('m2'));
    expect(next.people.find((p) => p.id === dora.id)!.mediaIds).toEqual(['m1', 'm2']);
    next = setPortrait(next, dora.id, 'm2');
    expect(next.people.find((p) => p.id === dora.id)!.mediaIds).toEqual(['m2', 'm1']);
    next = removeMedia(next, 'm2');
    expect(next.media.map((m) => m.id)).toEqual(['m1']);
    expect(next.people.find((p) => p.id === dora.id)!.mediaIds).toEqual(['m1']);
    expect(validateTreeDocument(next).ok).toBe(true);
  });

  it('deletes a person’s photos with them', () => {
    const { tree, dora } = complexFamily();
    const next = removePerson(addMedia(tree, dora.id, photo('m1')), dora.id);
    expect(next.media).toEqual([]);
  });
});

describe('serialization', () => {
  it('round-trips a complex tree through JSON without loss', () => {
    const { tree } = complexFamily();
    const result = validateTreeDocument(JSON.parse(JSON.stringify(tree)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tree).toEqual(tree);
  });
});
