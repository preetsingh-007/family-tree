import { useId, useMemo, useState } from 'react';
import { displayName, lifespan } from '../model/names';
import { searchPeople } from '../model/search';
import type { Id, Person } from '../model/types';

interface Props {
  people: readonly Person[];
  excludeIds: ReadonlySet<Id>;
  selectedId?: Id;
  onSelect: (id: Id) => void;
  label?: string;
}

/** Search-as-you-type list for choosing an existing person (a radio group, so it works with a keyboard). */
export function PersonPicker({ people, excludeIds, selectedId, onSelect, label = 'Find a person' }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const candidates = useMemo(() => {
    const available = people.filter((p) => !excludeIds.has(p.id));
    return query.trim() ? searchPeople(available, query, 30).map((r) => r.person) : available.slice(0, 30);
  }, [people, excludeIds, query]);

  return (
    <div className="person-picker">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="search"
        value={query}
        autoComplete="off"
        placeholder="Type a name, place, or year"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="picker-list" role="radiogroup" aria-label="Matching people">
        {candidates.length === 0 && <p className="muted">No matching people.</p>}
        {candidates.map((p) => (
          <label key={p.id} className={`picker-option ${selectedId === p.id ? 'selected' : ''}`}>
            <input type="radio" name={`${id}-choice`} checked={selectedId === p.id} onChange={() => onSelect(p.id)} />
            <span className="picker-name">{displayName(p)}</span>
            <span className="picker-meta">{lifespan(p)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
