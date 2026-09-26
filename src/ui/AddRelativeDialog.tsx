import { useId, useMemo, useState, type FormEvent } from 'react';
import { displayName } from '../model/names';
import { getParents, getPartners, type TreeIndex } from '../model/relatives';
import { addAssociation, addParentLink, addPartnership, addPerson, createPerson } from '../model/tree';
import {
  PARENT_LINK_KINDS,
  PARTNERSHIP_KINDS,
  type FamilyTreeDocument,
  type Id,
  type ParentLinkKind,
  type PartnershipKind,
  type Person,
} from '../model/types';
import { PARENT_KIND_LABELS, PARTNERSHIP_KIND_LABELS } from './labels';
import { Modal } from './Modal';
import { PersonPicker } from './PersonPicker';

export type RelationType = 'parent' | 'child' | 'partner' | 'sibling' | 'other';

const TITLES: Record<RelationType, string> = {
  parent: 'Add a parent',
  child: 'Add a child',
  partner: 'Add a partner or spouse',
  sibling: 'Add a sibling',
  other: 'Add another relationship',
};

interface Props {
  index: TreeIndex;
  person: Person;
  relation: RelationType;
  onApply: (label: string, change: (tree: FamilyTreeDocument) => FamilyTreeDocument) => string | undefined;
  /** Called with the id of the person who was connected. */
  onDone: (relativeId: Id) => void;
  onClose: () => void;
}

export function AddRelativeDialog({ index, person, relation, onApply, onDone, onClose }: Props) {
  const formId = useId();
  const name = displayName(person);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [givenNames, setGivenNames] = useState('');
  const [surname, setSurname] = useState(relation === 'child' || relation === 'sibling' ? person.surname : '');
  const [existingId, setExistingId] = useState<Id>();
  const [parentKind, setParentKind] = useState<ParentLinkKind>('biological');
  const [partnershipKind, setPartnershipKind] = useState<PartnershipKind>('marriage');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();

  const partners = useMemo(() => getPartners(index, person.id), [index, person.id]);
  const lineageParents = useMemo(
    () => getParents(index, person.id).filter((p) => p.link.kind !== 'step'),
    [index, person.id],
  );
  const [coParentId, setCoParentId] = useState<Id | ''>(partners.length === 1 ? partners[0]!.person.id : '');

  // When adding a second parent, offer to record the two parents as a couple.
  const existingParents = useMemo(() => getParents(index, person.id), [index, person.id]);
  const soleParent = relation === 'parent' && existingParents.length === 1 ? existingParents[0]!.person : undefined;
  const [linkParents, setLinkParents] = useState(true);

  const exclude = useMemo(() => new Set([person.id]), [person.id]);
  const siblingImpossible = relation === 'sibling' && lineageParents.length === 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (siblingImpossible) return;
    if (mode === 'existing' && !existingId) {
      setError('Choose a person from the list.');
      return;
    }
    if (relation === 'other' && !label.trim()) {
      setError('Describe the relationship.');
      return;
    }
    const newPerson = mode === 'new' ? createPerson({ givenNames: givenNames.trim(), surname: surname.trim() }) : undefined;
    const relativeId = newPerson?.id ?? existingId!;

    const result = onApply(TITLES[relation], (tree) => {
      let next = newPerson ? addPerson(tree, newPerson) : tree;
      switch (relation) {
        case 'parent':
          next = addParentLink(next, relativeId, person.id, parentKind);
          if (
            soleParent &&
            linkParents &&
            !next.partnerships.some((p) => p.partnerIds.includes(soleParent.id) && p.partnerIds.includes(relativeId))
          ) {
            next = addPartnership(next, soleParent.id, relativeId, 'partnership');
          }
          break;
        case 'child':
          next = addParentLink(next, person.id, relativeId, parentKind);
          if (coParentId) next = addParentLink(next, coParentId, relativeId, parentKind);
          break;
        case 'partner':
          next = addPartnership(next, person.id, relativeId, partnershipKind);
          break;
        case 'sibling':
          for (const parent of lineageParents) {
            if (!next.parentLinks.some((l) => l.parentId === parent.person.id && l.childId === relativeId)) {
              next = addParentLink(next, parent.person.id, relativeId, parentKind);
            }
          }
          break;
        case 'other':
          next = addAssociation(next, relativeId, person.id, label);
          break;
      }
      return next;
    });
    if (result) setError(result);
    else onDone(relativeId);
  };

  return (
    <Modal
      title={TITLES[relation]}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="button button-primary" disabled={siblingImpossible}>
            Add
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="stack" noValidate>
        {siblingImpossible ? (
          <p>
            Siblings are worked out from shared parents. Add at least one parent for {name} first — even an unnamed one — and
            then add siblings as that parent’s children.
          </p>
        ) : (
          <>
            <fieldset className="field">
              <legend className="field-label">Who?</legend>
              <div className="radio-row">
                <label className="radio">
                  <input type="radio" name={`${formId}-mode`} checked={mode === 'new'} onChange={() => setMode('new')} />
                  A new person
                </label>
                <label className="radio">
                  <input type="radio" name={`${formId}-mode`} checked={mode === 'existing'} onChange={() => setMode('existing')} />
                  Someone already in the tree
                </label>
              </div>
            </fieldset>

            {mode === 'new' ? (
              <div className="field-grid">
                <div className="field">
                  <label className="field-label" htmlFor={`${formId}-given`}>
                    Given names
                  </label>
                  <input id={`${formId}-given`} className="input" value={givenNames} onChange={(e) => setGivenNames(e.target.value)} data-autofocus autoComplete="off" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${formId}-surname`}>
                    Surname
                  </label>
                  <input id={`${formId}-surname`} className="input" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />
                </div>
                <p className="hint full-row">Names can be left blank if unknown. You can add more details afterwards.</p>
              </div>
            ) : (
              <PersonPicker people={index.tree.people} excludeIds={exclude} selectedId={existingId} onSelect={setExistingId} />
            )}

            {(relation === 'parent' || relation === 'child' || relation === 'sibling') && (
              <div className="field">
                <label className="field-label" htmlFor={`${formId}-kind`}>
                  {relation === 'sibling' ? 'Relationship to the parents' : 'Type of relationship'}
                </label>
                <select id={`${formId}-kind`} className="input" value={parentKind} onChange={(e) => setParentKind(e.target.value as ParentLinkKind)}>
                  {PARENT_LINK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PARENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {soleParent && (
              <label className="checkbox">
                <input type="checkbox" checked={linkParents} onChange={(e) => setLinkParents(e.target.checked)} />
                <span>Also record this person and {displayName(soleParent)} as a couple</span>
              </label>
            )}

            {relation === 'child' && partners.length > 0 && (
              <div className="field">
                <label className="field-label" htmlFor={`${formId}-coparent`}>
                  Other parent
                </label>
                <select id={`${formId}-coparent`} className="input" value={coParentId} onChange={(e) => setCoParentId(e.target.value)}>
                  <option value="">None / not recorded</option>
                  {partners
                    .filter((p, i, arr) => arr.findIndex((x) => x.person.id === p.person.id) === i)
                    .map((p) => (
                      <option key={p.person.id} value={p.person.id}>
                        {displayName(p.person)}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {relation === 'partner' && (
              <div className="field">
                <label className="field-label" htmlFor={`${formId}-pkind`}>
                  Type of relationship
                </label>
                <select
                  id={`${formId}-pkind`}
                  className="input"
                  value={partnershipKind}
                  onChange={(e) => setPartnershipKind(e.target.value as PartnershipKind)}
                >
                  {PARTNERSHIP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PARTNERSHIP_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <p className="hint">Dates, places, and how the relationship ended can be added afterwards.</p>
              </div>
            )}

            {relation === 'sibling' && (
              <p className="hint">
                The new sibling will be added as a child of{' '}
                {lineageParents.map((p) => displayName(p.person)).join(' and ')}.
              </p>
            )}

            {relation === 'other' && (
              <div className="field">
                <label className="field-label" htmlFor={`${formId}-label`}>
                  This person is {name}’s…
                </label>
                <input
                  id={`${formId}-label`}
                  className="input"
                  value={label}
                  placeholder="e.g. godparent, guardian, close family friend"
                  onChange={(e) => setLabel(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
