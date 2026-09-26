import { formatYearOnly } from './dates';
import type { Person } from './types';

export const UNNAMED = 'Unnamed person';

export function displayName(person: Pick<Person, 'fullName' | 'givenNames' | 'surname'>): string {
  const override = person.fullName?.trim();
  if (override) return override;
  const composed = [person.givenNames.trim(), person.surname.trim()].filter(Boolean).join(' ');
  return composed || UNNAMED;
}

export function initials(person: Person): string {
  const name = displayName(person);
  if (name === UNNAMED) return '?';
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "1890 – 1962", "b. 1890", "d. 1962" or "" */
export function lifespan(person: Person): string {
  const birth = formatYearOnly(person.birth?.date);
  const death = formatYearOnly(person.death?.date);
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.living === 'deceased' ? `${birth} – ?` : `b. ${birth}`;
  if (death) return `d. ${death}`;
  return '';
}

/** Sort people by surname, then given names, then id for stability. */
export function comparePeopleByName(a: Person, b: Person): number {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return (
    collator.compare(a.surname, b.surname) ||
    collator.compare(a.givenNames, b.givenNames) ||
    collator.compare(displayName(a), displayName(b)) ||
    a.id.localeCompare(b.id)
  );
}
