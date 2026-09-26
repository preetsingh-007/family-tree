import { useId, useMemo, useState, type FormEvent } from 'react';
import { newId } from '../model/ids';
import { displayName } from '../model/names';
import { ALTERNATE_NAME_TYPES, LIVING_STATUSES, SEX_VALUES, type AlternateNameType, type LivingStatus, type Person, type Sex } from '../model/types';
import { EMPTY_DATE_DRAFT } from './dateDraft';
import { DateInput } from './DateInput';
import { PlusIcon, TrashIcon } from './icons';
import { ALTERNATE_NAME_LABELS, EVENT_TYPE_SUGGESTIONS, LIVING_LABELS, SEX_LABELS } from './labels';
import { MarkdownEditor } from './MarkdownEditor';
import { ConfirmDialog } from './Modal';
import { applyPersonDraft, draftsEqual, toPersonDraft, type DraftErrors, type PersonDraft } from './personDraft';

interface Props {
  person: Person;
  isNew?: boolean;
  onSave: (person: Person) => string | undefined;
  onCancel: () => void;
}

function TextField({
  label,
  value,
  onChange,
  hint,
  autoFocus,
  autoComplete = 'off',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        data-autofocus={autoFocus || undefined}
        autoFocus={autoFocus}
      />
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function PersonEditor({ person, isNew, onSave, onCancel }: Props) {
  const initial = useMemo(() => toPersonDraft(person), [person]);
  const [draft, setDraft] = useState<PersonDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const eventListId = useId();
  const set = (patch: Partial<PersonDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const changed = !draftsEqual(draft, initial);
  const losesDeathInfo = draft.living === 'living' && !!person.death;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = applyPersonDraft(person, draft);
    setErrors(result.errors);
    if (!result.person) {
      setFormError('Some information needs attention before it can be saved.');
      return;
    }
    const error = onSave(result.person);
    setFormError(error);
  };

  const cancel = () => (changed ? setConfirmDiscard(true) : onCancel());

  return (
    <form className="person-editor" onSubmit={submit} noValidate aria-label={isNew ? 'New person' : `Edit ${displayName(person)}`}>
      <div className="editor-header">
        <h2>{isNew ? 'New person' : `Edit ${displayName(person)}`}</h2>
        <p className="muted">Every field is optional. Record only what you know.</p>
      </div>

      <section className="editor-section" aria-labelledby={`${eventListId}-names`}>
        <h3 id={`${eventListId}-names`}>Names</h3>
        <div className="field-grid">
          <TextField label="Given names" value={draft.givenNames} onChange={(v) => set({ givenNames: v })} autoFocus />
          <TextField label="Surname / family name" value={draft.surname} onChange={(v) => set({ surname: v })} />
        </div>
        <TextField
          label="Display name (optional)"
          value={draft.fullName}
          onChange={(v) => set({ fullName: v })}
          hint="Overrides how the name is shown, e.g. with titles or a different name order."
        />
        <div className="list-editor">
          <span className="field-label">Other names</span>
          {draft.alternateNames.map((n, i) => (
            <div className="list-row" key={n.key}>
              <label className="grow">
                <span className="visually-hidden">Other name {i + 1}</span>
                <input
                  className="input"
                  value={n.name}
                  placeholder="Name"
                  onChange={(e) =>
                    set({ alternateNames: draft.alternateNames.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                  }
                />
              </label>
              <label>
                <span className="visually-hidden">Type of other name {i + 1}</span>
                <select
                  className="input"
                  value={n.type}
                  onChange={(e) =>
                    set({
                      alternateNames: draft.alternateNames.map((x, j) =>
                        j === i ? { ...x, type: e.target.value as AlternateNameType } : x,
                      ),
                    })
                  }
                >
                  {ALTERNATE_NAME_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ALTERNATE_NAME_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove other name ${i + 1}`}
                onClick={() => set({ alternateNames: draft.alternateNames.filter((_, j) => j !== i) })}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button-small"
            onClick={() => set({ alternateNames: [...draft.alternateNames, { key: newId(), name: '', type: 'birth' }] })}
          >
            <PlusIcon /> Add another name
          </button>
        </div>
      </section>

      <section className="editor-section">
        <h3>About</h3>
        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${eventListId}-sex`}>
              Sex
            </label>
            <select id={`${eventListId}-sex`} className="input" value={draft.sex} onChange={(e) => set({ sex: e.target.value as Sex | '' })}>
              <option value="">Not recorded</option>
              {SEX_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SEX_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <TextField label="Gender (optional)" value={draft.gender} onChange={(v) => set({ gender: v })} />
        </div>
        <fieldset className="field">
          <legend className="field-label">Status</legend>
          <div className="radio-row">
            {LIVING_STATUSES.map((s) => (
              <label key={s} className="radio">
                <input type="radio" name={`${eventListId}-living`} checked={draft.living === s} onChange={() => set({ living: s as LivingStatus })} />
                {LIVING_LABELS[s]}
              </label>
            ))}
          </div>
          {losesDeathInfo && (
            <p className="warning" role="status">
              Saving as “Living” will remove the recorded death date and place.
            </p>
          )}
        </fieldset>
      </section>

      <section className="editor-section">
        <h3>Birth</h3>
        <DateInput legend="Birth date" value={draft.birthDate} onChange={(v) => set({ birthDate: v })} error={errors.birthDate} />
        <TextField label="Birth place" value={draft.birthPlace} onChange={(v) => set({ birthPlace: v })} />
      </section>

      {draft.living !== 'living' && (
        <section className="editor-section">
          <h3>Death</h3>
          <DateInput legend="Death date" value={draft.deathDate} onChange={(v) => set({ deathDate: v })} error={errors.deathDate} />
          <TextField label="Death place" value={draft.deathPlace} onChange={(v) => set({ deathPlace: v })} />
        </section>
      )}

      <section className="editor-section">
        <h3>Life events</h3>
        <datalist id={eventListId}>
          {EVENT_TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {draft.events.length === 0 && <p className="muted">Occupations, residences, migrations, education, and other events.</p>}
        {draft.events.map((e, i) => {
          const update = (patch: Partial<PersonDraft['events'][number]>) =>
            set({ events: draft.events.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div className="event-card" key={e.id}>
              <div className="event-card-head">
                <div className="field grow">
                  <label className="field-label" htmlFor={`${e.id}-type`}>
                    Event type
                  </label>
                  <input
                    id={`${e.id}-type`}
                    className="input"
                    list={eventListId}
                    value={e.type}
                    onChange={(ev) => update({ type: ev.target.value })}
                    aria-invalid={!!errors[`event-type-${i}`]}
                  />
                  {errors[`event-type-${i}`] && <p className="field-error">{errors[`event-type-${i}`]}</p>}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove event ${e.type || i + 1}`}
                  onClick={() => set({ events: draft.events.filter((_, j) => j !== i) })}
                >
                  <TrashIcon />
                </button>
              </div>
              <DateInput legend="Date" value={e.date} onChange={(v) => update({ date: v })} error={errors[`event-${i}`]} />
              <TextField label="Place" value={e.place} onChange={(v) => update({ place: v })} />
              <TextField label="Description" value={e.note} onChange={(v) => update({ note: v })} />
            </div>
          );
        })}
        <button
          type="button"
          className="button button-small"
          onClick={() => set({ events: [...draft.events, { id: newId(), type: '', date: EMPTY_DATE_DRAFT, place: '', note: '' }] })}
        >
          <PlusIcon /> Add event
        </button>
      </section>

      <section className="editor-section">
        <h3>Notes &amp; biography</h3>
        <MarkdownEditor label="Notes" value={draft.notes} onChange={(v) => set({ notes: v })} rows={10} />
      </section>

      <section className="editor-section">
        <h3>Other information</h3>
        {draft.customFields.map((f, i) => (
          <div className="list-row" key={f.id}>
            <label className="shrink">
              <span className="visually-hidden">Field {i + 1} label</span>
              <input
                className="input"
                placeholder="Label (e.g. Occupation)"
                value={f.label}
                aria-invalid={!!errors[`field-${i}`]}
                onChange={(ev) => set({ customFields: draft.customFields.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })}
              />
            </label>
            <label className="grow">
              <span className="visually-hidden">Field {i + 1} value</span>
              <input
                className="input"
                placeholder="Value"
                value={f.value}
                onChange={(ev) => set({ customFields: draft.customFields.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)) })}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove field ${f.label || i + 1}`}
              onClick={() => set({ customFields: draft.customFields.filter((_, j) => j !== i) })}
            >
              <TrashIcon />
            </button>
            {errors[`field-${i}`] && <p className="field-error full-row">{errors[`field-${i}`]}</p>}
          </div>
        ))}
        <button
          type="button"
          className="button button-small"
          onClick={() => set({ customFields: [...draft.customFields, { id: newId(), label: '', value: '' }] })}
        >
          <PlusIcon /> Add field
        </button>
      </section>

      <div className="editor-actions">
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary">
          {isNew ? 'Add person' : 'Save changes'}
        </button>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard changes"
          danger
          onConfirm={() => {
            setConfirmDiscard(false);
            onCancel();
          }}
          onCancel={() => setConfirmDiscard(false)}
        >
          <p>Your edits to this person have not been applied and will be lost.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
