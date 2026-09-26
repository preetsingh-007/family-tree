import { describe, expect, it } from 'vitest';
import { complexFamily, person } from '../test/fixtures';
import { searchPeople } from './search';

describe('search', () => {
  const { tree } = complexFamily();
  const find = (q: string) => searchPeople(tree.people, q).map((r) => r.person.givenNames);

  it('finds people by name, ignoring case and accents', () => {
    expect(find('dora')).toEqual(['Dora']);
    expect(find('TESTFIELD')).toHaveLength(6);
    expect(searchPeople([person('José', 'Núñez')], 'jose nunez')).toHaveLength(1);
  });

  it('requires every word to match', () => {
    expect(find('ed testfield')).toEqual(['Ed']);
    expect(find('ed sample')).toEqual([]);
  });

  it('matches prefixes and alternate names', () => {
    expect(find('bea')).toEqual(['Beatrice']);
    const results = searchPeople(tree.people, 'Beatrice Testfield');
    expect(results[0]?.person.givenNames).toBe('Beatrice');
  });

  it('searches places and years, ranking names first', () => {
    expect(find('exampleton')).toEqual(['Dora']);
    expect(find('1948')).toEqual(['Ed']);
    const results = searchPeople([person('Paris', 'Name'), person('Other', 'Person', { birth: { place: 'Paris' } })], 'paris');
    expect(results.map((r) => [r.person.givenNames, r.matchedField])).toEqual([
      ['Paris', 'name'],
      ['Other', 'place'],
    ]);
  });

  it('returns nothing for an empty query', () => {
    expect(find('   ')).toEqual([]);
  });

  it('stays fast on a large tree', () => {
    const many = Array.from({ length: 5000 }, (_, i) => person(`Given${i}`, `Surname${i % 97}`, { notes: 'Some biography text' }));
    const start = performance.now();
    const results = searchPeople(many, 'surname42');
    expect(results.length).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
