/**
 * In-memory, diacritic-insensitive search over people.
 *
 * Every query word must match (as a prefix of a word, or a substring for
 * longer words) somewhere in the person's searchable text. Name matches rank
 * above matches in places, notes, or custom fields.
 */
import { comparePeopleByName, displayName } from './names';
import type { Person } from './types';

export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function words(text: string): string[] {
  return normalizeForSearch(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export type SearchField = 'name' | 'alternate name' | 'year' | 'place' | 'details' | 'notes';

interface Section {
  field: SearchField;
  weight: number;
  words: string[];
}

export interface SearchResult {
  person: Person;
  score: number;
  /** The most relevant field that matched, for display. */
  matchedField: SearchField;
}

function sectionsFor(person: Person): Section[] {
  const years = [person.birth?.date?.year, person.death?.date?.year, ...person.events.map((e) => e.date?.year)]
    .filter((y): y is number => y !== undefined)
    .map(String);
  const places = [person.birth?.place, person.death?.place, ...person.events.map((e) => e.place)].filter(
    (p): p is string => !!p,
  );
  return [
    { field: 'name', weight: 10, words: words(`${displayName(person)} ${person.givenNames} ${person.surname}`) },
    { field: 'alternate name', weight: 8, words: words(person.alternateNames.map((n) => n.name).join(' ')) },
    { field: 'year', weight: 4, words: years },
    { field: 'place', weight: 3, words: words(places.join(' ')) },
    {
      field: 'details',
      weight: 2,
      words: words(
        [
          ...person.events.map((e) => `${e.type} ${e.note ?? ''}`),
          ...person.customFields.map((f) => `${f.label} ${f.value}`),
          person.gender ?? '',
        ].join(' '),
      ),
    },
    { field: 'notes', weight: 1, words: words(person.notes) },
  ];
}

function termScore(term: string, candidates: string[]): number {
  let best = 0;
  for (const word of candidates) {
    if (word === term) return 3;
    if (word.startsWith(term)) best = Math.max(best, 2);
    else if (term.length >= 3 && word.includes(term)) best = Math.max(best, 1);
  }
  return best;
}

export function searchPeople(people: readonly Person[], query: string, limit = 50): SearchResult[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const results: SearchResult[] = [];

  for (const person of people) {
    const sections = sectionsFor(person);
    let total = 0;
    let bestField: SearchField | undefined;
    let bestFieldScore = 0;
    let allMatched = true;

    for (const term of terms) {
      let termBest = 0;
      for (const section of sections) {
        const s = termScore(term, section.words) * section.weight;
        if (s > termBest) termBest = s;
        if (s > bestFieldScore) {
          bestFieldScore = s;
          bestField = section.field;
        }
      }
      if (termBest === 0) {
        allMatched = false;
        break;
      }
      total += termBest;
    }
    if (allMatched && bestField) results.push({ person, score: total, matchedField: bestField });
  }

  return results
    .sort((a, b) => b.score - a.score || comparePeopleByName(a.person, b.person))
    .slice(0, limit);
}
