import { useDeferredValue, useId, useMemo, useState } from 'react';
import { comparePeopleByName, displayName, lifespan } from '../model/names';
import { searchPeople } from '../model/search';
import type { Id, Person } from '../model/types';
import { PlusIcon, SearchIcon } from './icons';

interface Props {
  people: readonly Person[];
  selectedId?: Id;
  onSelect: (id: Id) => void;
  /** Omitted when the tree is view-only. */
  onAddPerson?: () => void;
}

const PAGE = 200;

/** Searchable list of everyone in the tree: the accessible, non-graphical way to find people. */
export function PeoplePanel({ people, selectedId, onSelect, onAddPerson }: Props) {
  const searchId = useId();
  const statusId = useId();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    if (deferredQuery.trim()) return searchPeople(people, deferredQuery, 500);
    return [...people].sort(comparePeopleByName).map((person) => ({ person, matchedField: undefined }));
  }, [people, deferredQuery]);

  const shown = results.slice(0, limit);
  const status = deferredQuery.trim()
    ? `${results.length === 500 ? 'Over 500' : results.length} ${results.length === 1 ? 'match' : 'matches'}`
    : `${people.length} ${people.length === 1 ? 'person' : 'people'}`;

  return (
    <section className="people-panel" aria-label="People">
      <div className="people-panel-head">
        <div className="search-box">
          <label htmlFor={searchId} className="visually-hidden">
            Search people
          </label>
          <SearchIcon className="search-icon" />
          <input
            id={searchId}
            className="input search-input"
            type="search"
            placeholder="Search names, places, years…"
            value={query}
            autoComplete="off"
            aria-describedby={statusId}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) onSelect(results[0].person.id);
            }}
          />
        </div>
        {onAddPerson && (
          <button type="button" className="button button-primary add-person-button" onClick={onAddPerson}>
            <PlusIcon /> Add person
          </button>
        )}
      </div>
      <p id={statusId} className="people-count" role="status">
        {status}
      </p>
      <ul className="people-list">
        {shown.map(({ person, matchedField }) => (
          <li key={person.id}>
            <button
              type="button"
              className={`person-row ${person.id === selectedId ? 'selected' : ''}`}
              aria-current={person.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(person.id)}
            >
              <span className="person-row-name">{displayName(person)}</span>
              <span className="person-row-meta">
                {lifespan(person)}
                {matchedField && matchedField !== 'name' && <span className="match-hint"> · matched {matchedField}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {results.length > limit && (
        <button type="button" className="button button-small show-more" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({results.length - limit} remaining)
        </button>
      )}
      {people.length === 0 && <p className="muted empty-hint">No one has been added yet.</p>}
    </section>
  );
}
