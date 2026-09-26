import { describe, expect, it } from 'vitest';
import { person } from '../test/fixtures';
import { EMPTY_DATE_DRAFT, fromDateDraft, toDateDraft } from './dateDraft';
import { applyPersonDraft, toPersonDraft } from './personDraft';

describe('date form conversion', () => {
  it('treats empty fields as an unknown date', () => {
    expect(fromDateDraft(EMPTY_DATE_DRAFT, 'Birth')).toEqual({ errors: [] });
  });

  it('round-trips partial and approximate dates', () => {
    const date = { qualifier: 'about' as const, year: 1890, month: 5 };
    expect(fromDateDraft(toDateDraft(date), 'Birth')).toEqual({ date, errors: [] });
    const range = { qualifier: 'between' as const, year: 1890, end: { year: 1895 } };
    expect(fromDateDraft(toDateDraft(range), 'Birth')).toEqual({ date: range, errors: [] });
  });

  it('reports invalid input', () => {
    expect(fromDateDraft({ ...EMPTY_DATE_DRAFT, year: '18x0' }, 'Birth').errors[0]).toMatch(/whole number/);
    expect(fromDateDraft({ ...EMPTY_DATE_DRAFT, year: '1900', month: '2', day: '30' }, 'Birth').errors[0]).toMatch(/does not exist/);
  });
});

describe('person form conversion', () => {
  it('applies edits and drops empty optional values', () => {
    const original = person('Ann', 'Old', { gender: 'woman', fullName: 'Dr Ann Old' });
    const draft = {
      ...toPersonDraft(original),
      givenNames: '  Anna ',
      fullName: '',
      gender: ' ',
      birthDate: { ...EMPTY_DATE_DRAFT, year: '1901' },
      birthPlace: 'Exampleton',
      alternateNames: [{ key: 'k', name: ' ', type: 'nickname' as const }],
    };
    const { person: updated, errors } = applyPersonDraft(original, draft);
    expect(errors).toEqual({});
    expect(updated).toMatchObject({ givenNames: 'Anna', birth: { date: { qualifier: 'exact', year: 1901 }, place: 'Exampleton' } });
    expect(updated!.fullName).toBeUndefined();
    expect(updated!.gender).toBeUndefined();
    expect(updated!.alternateNames).toEqual([]);
  });

  it('removes death information when a person is marked as living', () => {
    const original = person('Ann', 'Old', { living: 'deceased', death: { place: 'Exampleton' } });
    const { person: updated } = applyPersonDraft(original, { ...toPersonDraft(original), living: 'living' });
    expect(updated!.death).toBeUndefined();
  });

  it('returns field errors instead of saving invalid data', () => {
    const original = person('Ann', 'Old');
    const draft = toPersonDraft(original);
    const result = applyPersonDraft(original, {
      ...draft,
      birthDate: { ...EMPTY_DATE_DRAFT, month: '13' },
      events: [{ id: 'e', type: '', date: EMPTY_DATE_DRAFT, place: '', note: '' }],
      customFields: [{ id: 'f', label: '', value: 'orphan value' }],
    });
    expect(result.person).toBeUndefined();
    expect(Object.keys(result.errors).sort()).toEqual(['birthDate', 'event-type-0', 'field-0']);
  });
});
