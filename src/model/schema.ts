/**
 * Structural and semantic validation for family-tree documents.
 *
 * Imported data is untrusted: it may be hand-edited, truncated, produced by an
 * older/newer version, or deliberately malformed. Everything that enters the
 * application goes through validateTreeDocument().
 */
import { z } from 'zod';
import { validateFuzzyDate } from './dates';
import { migrateToCurrent } from './migrate';
import {
  ALTERNATE_NAME_TYPES,
  DATE_QUALIFIERS,
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  LIVING_STATUSES,
  MEDIA_MIME_TYPES,
  PARENT_LINK_KINDS,
  PARTNERSHIP_END_REASONS,
  PARTNERSHIP_KINDS,
  SEX_VALUES,
  type FamilyTreeDocument,
  type FuzzyDate,
} from './types';

const SHORT_TEXT = 1_000;
const LONG_TEXT = 1_000_000;
/** ~12 MB of base64 per image; the UI stores much smaller, resized images. */
const MAX_MEDIA_BASE64 = 16_000_000;

const id = z.string().min(1).max(200);
const shortText = z.string().max(SHORT_TEXT);
const longText = z.string().max(LONG_TEXT);
const optionalShort = shortText.optional();

const dateParts = {
  year: z.number().int().optional(),
  month: z.number().int().optional(),
  day: z.number().int().optional(),
};

const fuzzyDate = z
  .object({
    ...dateParts,
    qualifier: z.enum(DATE_QUALIFIERS),
    end: z.object(dateParts).strict().optional(),
    text: optionalShort,
  })
  .strict();

const lifeEvent = z.object({ date: fuzzyDate.optional(), place: optionalShort, note: longText.optional() }).strict();

const person = z
  .object({
    id,
    givenNames: shortText,
    surname: shortText,
    fullName: optionalShort,
    alternateNames: z.array(z.object({ name: shortText, type: z.enum(ALTERNATE_NAME_TYPES) }).strict()),
    sex: z.enum(SEX_VALUES).optional(),
    gender: optionalShort,
    living: z.enum(LIVING_STATUSES),
    birth: lifeEvent.optional(),
    death: lifeEvent.optional(),
    events: z.array(lifeEvent.extend({ id, type: shortText }).strict()),
    notes: longText,
    customFields: z.array(z.object({ id, label: shortText, value: longText }).strict()),
    mediaIds: z.array(id),
  })
  .strict();

const parentLink = z
  .object({ id, parentId: id, childId: id, kind: z.enum(PARENT_LINK_KINDS), note: longText.optional() })
  .strict();

const partnership = z
  .object({
    id,
    partnerIds: z.tuple([id, id]),
    kind: z.enum(PARTNERSHIP_KINDS),
    start: lifeEvent.optional(),
    end: lifeEvent.extend({ reason: z.enum(PARTNERSHIP_END_REASONS).optional() }).strict().optional(),
    note: longText.optional(),
  })
  .strict();

const association = z
  .object({ id, personIds: z.tuple([id, id]), label: shortText.min(1), note: longText.optional() })
  .strict();

const media = z
  .object({
    id,
    mimeType: z.enum(MEDIA_MIME_TYPES),
    data: z.string().max(MAX_MEDIA_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'must be base64'),
    caption: optionalShort,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export const treeDocumentSchema = z
  .object({
    format: z.literal(DOCUMENT_FORMAT),
    version: z.literal(DOCUMENT_VERSION),
    id,
    title: shortText,
    notes: longText,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    people: z.array(person),
    parentLinks: z.array(parentLink),
    partnerships: z.array(partnership),
    associations: z.array(association),
    media: z.array(media),
  })
  .strict();

export type ValidationResult =
  | { ok: true; tree: FamilyTreeDocument }
  | { ok: false; errors: string[] };

const MAX_REPORTED_ERRORS = 20;

function formatPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part), '');
}

/** Checks references, identifiers, dates, and impossible relationships. */
export function findSemanticProblems(tree: FamilyTreeDocument): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const checkUnique = (value: string, where: string) => {
    if (seenIds.has(value)) errors.push(`${where}: duplicate identifier "${value}".`);
    seenIds.add(value);
  };

  tree.people.forEach((p, i) => checkUnique(p.id, `people[${i}]`));
  tree.parentLinks.forEach((l, i) => checkUnique(l.id, `parentLinks[${i}]`));
  tree.partnerships.forEach((p, i) => checkUnique(p.id, `partnerships[${i}]`));
  tree.associations.forEach((a, i) => checkUnique(a.id, `associations[${i}]`));
  tree.media.forEach((m, i) => checkUnique(m.id, `media[${i}]`));

  const personIds = new Set(tree.people.map((p) => p.id));
  const mediaIds = new Set(tree.media.map((m) => m.id));
  const mediaOwners = new Map<string, number>();

  const checkDate = (date: FuzzyDate | undefined, where: string) => {
    if (date) errors.push(...validateFuzzyDate(date, where));
  };

  tree.people.forEach((p, i) => {
    const where = `people[${i}]`;
    checkDate(p.birth?.date, `${where}.birth.date`);
    checkDate(p.death?.date, `${where}.death.date`);
    p.events.forEach((e, j) => {
      checkUnique(e.id, `${where}.events[${j}]`);
      checkDate(e.date, `${where}.events[${j}].date`);
    });
    p.customFields.forEach((f, j) => checkUnique(f.id, `${where}.customFields[${j}]`));
    p.mediaIds.forEach((mediaId, j) => {
      if (!mediaIds.has(mediaId)) errors.push(`${where}.mediaIds[${j}]: refers to a photo that does not exist.`);
      mediaOwners.set(mediaId, (mediaOwners.get(mediaId) ?? 0) + 1);
    });
  });

  for (const [mediaId, count] of mediaOwners) {
    if (count > 1) errors.push(`Photo "${mediaId}" is attached to more than one person.`);
  }

  const parentPairs = new Set<string>();
  tree.parentLinks.forEach((l, i) => {
    const where = `parentLinks[${i}]`;
    if (!personIds.has(l.parentId)) errors.push(`${where}: parent refers to a person who does not exist.`);
    if (!personIds.has(l.childId)) errors.push(`${where}: child refers to a person who does not exist.`);
    if (l.parentId === l.childId) errors.push(`${where}: a person cannot be their own parent.`);
    const pair = `${l.parentId}\u0000${l.childId}`;
    if (parentPairs.has(pair)) errors.push(`${where}: duplicate parent–child relationship.`);
    parentPairs.add(pair);
  });

  tree.partnerships.forEach((p, i) => {
    const where = `partnerships[${i}]`;
    p.partnerIds.forEach((pid) => {
      if (!personIds.has(pid)) errors.push(`${where}: refers to a person who does not exist.`);
    });
    if (p.partnerIds[0] === p.partnerIds[1]) errors.push(`${where}: a person cannot be their own partner.`);
    checkDate(p.start?.date, `${where}.start.date`);
    checkDate(p.end?.date, `${where}.end.date`);
  });

  tree.associations.forEach((a, i) => {
    const where = `associations[${i}]`;
    a.personIds.forEach((pid) => {
      if (!personIds.has(pid)) errors.push(`${where}: refers to a person who does not exist.`);
    });
    if (a.personIds[0] === a.personIds[1]) errors.push(`${where}: a relationship needs two different people.`);
  });

  if (hasAncestryCycle(tree)) errors.push('The parent–child relationships contain a loop (someone would be their own ancestor).');

  return errors;
}

function hasAncestryCycle(tree: FamilyTreeDocument): boolean {
  const children = new Map<string, string[]>();
  for (const l of tree.parentLinks) {
    const list = children.get(l.parentId);
    if (list) list.push(l.childId);
    else children.set(l.parentId, [l.childId]);
  }
  // Iterative three-colour DFS so very deep trees cannot overflow the stack.
  const state = new Map<string, 1 | 2>();
  for (const start of children.keys()) {
    if (state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const next = children.get(frame[0])?.[frame[1]];
      if (next === undefined) {
        state.set(frame[0], 2);
        stack.pop();
        continue;
      }
      frame[1]++;
      const s = state.get(next);
      if (s === 1) return true;
      if (s === undefined) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  return false;
}

/** Validates (and migrates, if necessary) an untrusted value into a current-version document. */
export function validateTreeDocument(input: unknown): ValidationResult {
  const migrated = migrateToCurrent(input);
  if (!migrated.ok) return migrated;

  const parsed = treeDocumentSchema.safeParse(migrated.value);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, MAX_REPORTED_ERRORS)
      .map((issue) => `${formatPath(issue.path) || 'document'}: ${issue.message}`);
    return { ok: false, errors };
  }
  const tree = parsed.data as FamilyTreeDocument;
  const problems = findSemanticProblems(tree);
  if (problems.length) return { ok: false, errors: problems.slice(0, MAX_REPORTED_ERRORS) };
  return { ok: true, tree };
}
