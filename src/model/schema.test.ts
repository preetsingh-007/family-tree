import { describe, expect, it } from 'vitest';
import { complexFamily } from '../test/fixtures';
import { validateTreeDocument } from './schema';

function mutated(change: (doc: Record<string, any>) => void) {
  const doc = JSON.parse(JSON.stringify(complexFamily().tree));
  change(doc);
  return validateTreeDocument(doc);
}

function expectInvalid(result: ReturnType<typeof validateTreeDocument>, pattern: RegExp) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join('\n')).toMatch(pattern);
}

describe('document validation', () => {
  it('accepts a valid document', () => {
    expect(validateTreeDocument(complexFamily().tree).ok).toBe(true);
  });

  it('rejects things that are not family-tree documents', () => {
    expectInvalid(validateTreeDocument(null), /not a family-tree document/);
    expectInvalid(validateTreeDocument([]), /not a family-tree document/);
    expectInvalid(validateTreeDocument({ format: 'something-else' }), /not a family-tree document/);
  });

  it('rejects unsupported versions with a helpful message', () => {
    expectInvalid(mutated((d) => (d.version = 99)), /newer than this application supports/);
    expectInvalid(mutated((d) => (d.version = 0)), /version is missing or invalid/);
    expectInvalid(mutated((d) => (d.version = '1')), /version is missing or invalid/);
  });

  it('rejects malformed structures and unexpected fields', () => {
    expectInvalid(mutated((d) => (d.people = 'nope')), /people/);
    expectInvalid(mutated((d) => (d.people[0].living = 'maybe')), /people\[0\]\.living/);
    expectInvalid(mutated((d) => (d.people[0].surprise = true)), /people\[0\]/);
    expectInvalid(mutated((d) => delete d.parentLinks), /parentLinks/);
    expectInvalid(mutated((d) => (d.people[0].notes = 'x'.repeat(1_000_001))), /notes/);
  });

  it('rejects malformed dates', () => {
    expectInvalid(
      mutated((d) => (d.people[0].birth = { date: { qualifier: 'exact', year: 1900, month: 2, day: 30 } })),
      /birth\.date: day 30 does not exist/,
    );
    expectInvalid(mutated((d) => (d.people[0].birth = { date: { qualifier: 'sometime', year: 1900 } })), /qualifier/);
  });

  it('rejects duplicate identifiers', () => {
    expectInvalid(mutated((d) => (d.people[1].id = d.people[0].id)), /duplicate identifier/);
    expectInvalid(mutated((d) => (d.parentLinks[1].id = d.people[0].id)), /duplicate identifier/);
  });

  it('rejects broken and impossible relationship references', () => {
    expectInvalid(mutated((d) => (d.parentLinks[0].parentId = 'ghost')), /parent refers to a person who does not exist/);
    expectInvalid(mutated((d) => (d.partnerships[0].partnerIds[1] = 'ghost')), /does not exist/);
    expectInvalid(mutated((d) => (d.parentLinks[0].childId = d.parentLinks[0].parentId)), /own parent/);
    expectInvalid(mutated((d) => d.parentLinks.push({ ...d.parentLinks[0], id: 'dup' })), /duplicate parent/);
    expectInvalid(mutated((d) => (d.people[0].mediaIds = ['missing-photo'])), /photo that does not exist/);
  });

  it('rejects ancestry loops', () => {
    const { tree, arthur, hana } = complexFamily();
    const doc = JSON.parse(JSON.stringify(tree));
    doc.parentLinks.push({ id: 'loop', parentId: hana.id, childId: arthur.id, kind: 'biological' });
    expectInvalid(validateTreeDocument(doc), /loop/);
  });

  it('allows legitimate real-world situations', () => {
    const { tree, arthur, beatrice, hana, ed } = complexFamily();
    const doc = JSON.parse(JSON.stringify(tree));
    // Remarriage to the same person, a person with four parents (birth + adoptive), missing names and dates.
    doc.partnerships.push({ id: 'again', partnerIds: [beatrice.id, arthur.id], kind: 'marriage' });
    doc.parentLinks.push({ id: 'bio', parentId: arthur.id, childId: hana.id, kind: 'biological' });
    doc.people.push({
      id: 'unnamed',
      givenNames: '',
      surname: '',
      alternateNames: [],
      living: 'unknown',
      events: [],
      notes: '',
      customFields: [],
      mediaIds: [],
    });
    doc.parentLinks.push({ id: 'unknown-parent', parentId: 'unnamed', childId: ed.id, kind: 'unknown' });
    expect(validateTreeDocument(doc)).toMatchObject({ ok: true });
  });
});
