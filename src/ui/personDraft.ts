/** Form state for editing a person, and conversion back to a validated Person. */
import { newId } from '../model/ids';
import type { AlternateNameType, LifeEvent, LivingStatus, Person, PersonEvent, Sex } from '../model/types';
import { fromDateDraft, toDateDraft, type DateDraft } from './dateDraft';

export interface PersonDraft {
  givenNames: string;
  surname: string;
  fullName: string;
  alternateNames: { key: string; name: string; type: AlternateNameType }[];
  sex: Sex | '';
  gender: string;
  living: LivingStatus;
  birthDate: DateDraft;
  birthPlace: string;
  deathDate: DateDraft;
  deathPlace: string;
  events: { id: string; type: string; date: DateDraft; place: string; note: string }[];
  notes: string;
  customFields: { id: string; label: string; value: string }[];
}

export function toPersonDraft(person: Person): PersonDraft {
  return {
    givenNames: person.givenNames,
    surname: person.surname,
    fullName: person.fullName ?? '',
    alternateNames: person.alternateNames.map((n) => ({ key: newId(), ...n })),
    sex: person.sex ?? '',
    gender: person.gender ?? '',
    living: person.living,
    birthDate: toDateDraft(person.birth?.date),
    birthPlace: person.birth?.place ?? '',
    deathDate: toDateDraft(person.death?.date),
    deathPlace: person.death?.place ?? '',
    events: person.events.map((e) => ({
      id: e.id,
      type: e.type,
      date: toDateDraft(e.date),
      place: e.place ?? '',
      note: e.note ?? '',
    })),
    notes: person.notes,
    customFields: person.customFields.map((f) => ({ ...f })),
  };
}

function lifeEvent(date: LifeEvent['date'], place: string, previous?: LifeEvent): LifeEvent | undefined {
  const event: LifeEvent = {};
  if (date) event.date = date;
  if (place.trim()) event.place = place.trim();
  if (previous?.note) event.note = previous.note;
  return Object.keys(event).length ? event : undefined;
}

export type DraftErrors = Record<string, string>;

/** Builds the updated person, or returns field-keyed error messages. */
export function applyPersonDraft(person: Person, draft: PersonDraft): { person?: Person; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const birth = fromDateDraft(draft.birthDate, 'Birth date');
  if (birth.errors.length) errors.birthDate = birth.errors.join(' ');
  const recordsDeath = draft.living !== 'living';
  const death = recordsDeath ? fromDateDraft(draft.deathDate, 'Death date') : { errors: [] };
  if (death.errors.length) errors.deathDate = death.errors.join(' ');

  const events: PersonEvent[] = [];
  draft.events.forEach((e, i) => {
    const parsed = fromDateDraft(e.date, `${e.type.trim() || 'Event'} date`);
    if (parsed.errors.length) errors[`event-${i}`] = parsed.errors.join(' ');
    if (!e.type.trim()) errors[`event-type-${i}`] = 'Give the event a type, e.g. “Occupation”.';
    const event: PersonEvent = { id: e.id, type: e.type.trim() };
    if (parsed.date) event.date = parsed.date;
    if (e.place.trim()) event.place = e.place.trim();
    if (e.note.trim()) event.note = e.note.trim();
    events.push(event);
  });

  draft.customFields.forEach((f, i) => {
    if (!f.label.trim() && f.value.trim()) errors[`field-${i}`] = 'Give this field a label.';
  });

  if (Object.keys(errors).length) return { errors };

  const updated: Person = {
    ...person,
    givenNames: draft.givenNames.trim(),
    surname: draft.surname.trim(),
    alternateNames: draft.alternateNames
      .filter((n) => n.name.trim())
      .map((n) => ({ name: n.name.trim(), type: n.type })),
    living: draft.living,
    events,
    notes: draft.notes,
    customFields: draft.customFields
      .filter((f) => f.label.trim() || f.value.trim())
      .map((f) => ({ id: f.id, label: f.label.trim(), value: f.value })),
  };
  const fullName = draft.fullName.trim();
  if (fullName) updated.fullName = fullName;
  else delete updated.fullName;
  if (draft.sex) updated.sex = draft.sex;
  else delete updated.sex;
  if (draft.gender.trim()) updated.gender = draft.gender.trim();
  else delete updated.gender;

  const birthEvent = lifeEvent(birth.date, draft.birthPlace, person.birth);
  if (birthEvent) updated.birth = birthEvent;
  else delete updated.birth;
  const deathEvent = recordsDeath ? lifeEvent(death.date, draft.deathPlace, person.death) : undefined;
  if (deathEvent) updated.death = deathEvent;
  else delete updated.death;

  return { person: updated, errors };
}

export function draftsEqual(a: PersonDraft, b: PersonDraft): boolean {
  const strip = (d: PersonDraft) => ({ ...d, alternateNames: d.alternateNames.map(({ name, type }) => ({ name, type })) });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
