/**
 * Pure, immutable operations on a FamilyTreeDocument.
 *
 * Every mutating function returns a new document and throws a TreeError when the
 * requested change would leave the tree inconsistent (dangling references,
 * self-relationships, or a person becoming their own ancestor).
 */
import { newId } from './ids';
import {
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  type Association,
  type FamilyTreeDocument,
  type Id,
  type MediaItem,
  type ParentLink,
  type ParentLinkKind,
  type Partnership,
  type PartnershipKind,
  type Person,
} from './types';

export class TreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TreeError';
  }
}

export function createEmptyTree(title: string, now = new Date()): FamilyTreeDocument {
  const timestamp = now.toISOString();
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    id: newId(),
    title: title.trim() || 'Our family',
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    people: [],
    parentLinks: [],
    partnerships: [],
    associations: [],
    media: [],
  };
}

export function createPerson(fields: Partial<Omit<Person, 'id'>> = {}): Person {
  return {
    id: newId(),
    givenNames: '',
    surname: '',
    alternateNames: [],
    living: 'unknown',
    events: [],
    notes: '',
    customFields: [],
    mediaIds: [],
    ...fields,
  };
}

function requirePerson(tree: FamilyTreeDocument, id: Id): Person {
  const person = tree.people.find((p) => p.id === id);
  if (!person) throw new TreeError('That person is no longer in the tree.');
  return person;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function addPerson(tree: FamilyTreeDocument, person: Person): FamilyTreeDocument {
  if (tree.people.some((p) => p.id === person.id)) throw new TreeError('A person with this identifier already exists.');
  return { ...tree, people: [...tree.people, person] };
}

export function updatePerson(tree: FamilyTreeDocument, person: Person): FamilyTreeDocument {
  requirePerson(tree, person.id);
  const mediaIds = new Set(tree.media.map((m) => m.id));
  if (person.mediaIds.some((id) => !mediaIds.has(id))) throw new TreeError('A photo referenced by this person is missing.');
  return { ...tree, people: tree.people.map((p) => (p.id === person.id ? person : p)) };
}

/** Everything that would be removed along with a person. */
export function describePersonRemoval(tree: FamilyTreeDocument, id: Id) {
  const person = requirePerson(tree, id);
  return {
    parentLinks: tree.parentLinks.filter((l) => l.parentId === id || l.childId === id).length,
    partnerships: tree.partnerships.filter((p) => p.partnerIds.includes(id)).length,
    associations: tree.associations.filter((a) => a.personIds.includes(id)).length,
    media: person.mediaIds.length,
  };
}

/** Removes a person together with all relationships and photos that belong to them. */
export function removePerson(tree: FamilyTreeDocument, id: Id): FamilyTreeDocument {
  const person = requirePerson(tree, id);
  const ownMedia = new Set(person.mediaIds);
  return {
    ...tree,
    people: tree.people.filter((p) => p.id !== id),
    parentLinks: tree.parentLinks.filter((l) => l.parentId !== id && l.childId !== id),
    partnerships: tree.partnerships.filter((p) => !p.partnerIds.includes(id)),
    associations: tree.associations.filter((a) => !a.personIds.includes(id)),
    media: tree.media.filter((m) => !ownMedia.has(m.id)),
  };
}

// ---------------------------------------------------------------------------
// Parent / child
// ---------------------------------------------------------------------------

/** True if `ancestorId` is `personId` or one of their ancestors. */
export function isAncestorOrSelf(tree: FamilyTreeDocument, ancestorId: Id, personId: Id): boolean {
  const parentsByChild = new Map<Id, Id[]>();
  for (const link of tree.parentLinks) {
    const list = parentsByChild.get(link.childId);
    if (list) list.push(link.parentId);
    else parentsByChild.set(link.childId, [link.parentId]);
  }
  const seen = new Set<Id>();
  const stack = [personId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === ancestorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(parentsByChild.get(current) ?? []));
  }
  return false;
}

export function addParentLink(
  tree: FamilyTreeDocument,
  parentId: Id,
  childId: Id,
  kind: ParentLinkKind = 'biological',
  id: Id = newId(),
): FamilyTreeDocument {
  requirePerson(tree, parentId);
  requirePerson(tree, childId);
  if (parentId === childId) throw new TreeError('A person cannot be their own parent.');
  if (tree.parentLinks.some((l) => l.parentId === parentId && l.childId === childId)) {
    throw new TreeError('This parent–child relationship already exists.');
  }
  if (isAncestorOrSelf(tree, childId, parentId)) {
    throw new TreeError('This would make someone their own ancestor.');
  }
  const link: ParentLink = { id, parentId, childId, kind };
  return { ...tree, parentLinks: [...tree.parentLinks, link] };
}

export function updateParentLink(tree: FamilyTreeDocument, link: ParentLink): FamilyTreeDocument {
  const existing = tree.parentLinks.find((l) => l.id === link.id);
  if (!existing) throw new TreeError('That relationship no longer exists.');
  if (existing.parentId !== link.parentId || existing.childId !== link.childId) {
    throw new TreeError('Remove the relationship and add a new one to change who it connects.');
  }
  return { ...tree, parentLinks: tree.parentLinks.map((l) => (l.id === link.id ? link : l)) };
}

export function removeParentLink(tree: FamilyTreeDocument, id: Id): FamilyTreeDocument {
  if (!tree.parentLinks.some((l) => l.id === id)) throw new TreeError('That relationship no longer exists.');
  return { ...tree, parentLinks: tree.parentLinks.filter((l) => l.id !== id) };
}

// ---------------------------------------------------------------------------
// Partnerships
// ---------------------------------------------------------------------------

export function addPartnership(
  tree: FamilyTreeDocument,
  aId: Id,
  bId: Id,
  kind: PartnershipKind = 'marriage',
  id: Id = newId(),
): FamilyTreeDocument {
  requirePerson(tree, aId);
  requirePerson(tree, bId);
  if (aId === bId) throw new TreeError('A person cannot be their own partner.');
  const partnership: Partnership = { id, partnerIds: [aId, bId], kind };
  return { ...tree, partnerships: [...tree.partnerships, partnership] };
}

export function updatePartnership(tree: FamilyTreeDocument, partnership: Partnership): FamilyTreeDocument {
  const existing = tree.partnerships.find((p) => p.id === partnership.id);
  if (!existing) throw new TreeError('That partnership no longer exists.');
  const [a, b] = partnership.partnerIds;
  if (!sameMembers(existing.partnerIds, partnership.partnerIds)) {
    throw new TreeError('Remove the partnership and add a new one to change who it connects.');
  }
  if (a === b) throw new TreeError('A person cannot be their own partner.');
  return { ...tree, partnerships: tree.partnerships.map((p) => (p.id === partnership.id ? partnership : p)) };
}

export function removePartnership(tree: FamilyTreeDocument, id: Id): FamilyTreeDocument {
  if (!tree.partnerships.some((p) => p.id === id)) throw new TreeError('That partnership no longer exists.');
  return { ...tree, partnerships: tree.partnerships.filter((p) => p.id !== id) };
}

function sameMembers(a: [Id, Id], b: [Id, Id]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

// ---------------------------------------------------------------------------
// Other relationships
// ---------------------------------------------------------------------------

export function addAssociation(
  tree: FamilyTreeDocument,
  fromId: Id,
  toId: Id,
  label: string,
  id: Id = newId(),
): FamilyTreeDocument {
  requirePerson(tree, fromId);
  requirePerson(tree, toId);
  if (fromId === toId) throw new TreeError('A relationship needs two different people.');
  const trimmed = label.trim();
  if (!trimmed) throw new TreeError('Describe the relationship (for example "godparent").');
  const association: Association = { id, personIds: [fromId, toId], label: trimmed };
  return { ...tree, associations: [...tree.associations, association] };
}

export function removeAssociation(tree: FamilyTreeDocument, id: Id): FamilyTreeDocument {
  if (!tree.associations.some((a) => a.id === id)) throw new TreeError('That relationship no longer exists.');
  return { ...tree, associations: tree.associations.filter((a) => a.id !== id) };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function addMedia(tree: FamilyTreeDocument, personId: Id, media: MediaItem): FamilyTreeDocument {
  const person = requirePerson(tree, personId);
  if (tree.media.some((m) => m.id === media.id)) throw new TreeError('This photo is already in the tree.');
  const updated: Person = { ...person, mediaIds: [...person.mediaIds, media.id] };
  return {
    ...tree,
    media: [...tree.media, media],
    people: tree.people.map((p) => (p.id === personId ? updated : p)),
  };
}

export function updateMedia(tree: FamilyTreeDocument, media: MediaItem): FamilyTreeDocument {
  if (!tree.media.some((m) => m.id === media.id)) throw new TreeError('That photo no longer exists.');
  return { ...tree, media: tree.media.map((m) => (m.id === media.id ? media : m)) };
}

export function removeMedia(tree: FamilyTreeDocument, mediaId: Id): FamilyTreeDocument {
  if (!tree.media.some((m) => m.id === mediaId)) throw new TreeError('That photo no longer exists.');
  return {
    ...tree,
    media: tree.media.filter((m) => m.id !== mediaId),
    people: tree.people.map((p) =>
      p.mediaIds.includes(mediaId) ? { ...p, mediaIds: p.mediaIds.filter((id) => id !== mediaId) } : p,
    ),
  };
}

/** Makes the given photo the person's portrait (first in their list). */
export function setPortrait(tree: FamilyTreeDocument, personId: Id, mediaId: Id): FamilyTreeDocument {
  const person = requirePerson(tree, personId);
  if (!person.mediaIds.includes(mediaId)) throw new TreeError('That photo does not belong to this person.');
  const updated = { ...person, mediaIds: [mediaId, ...person.mediaIds.filter((id) => id !== mediaId)] };
  return { ...tree, people: tree.people.map((p) => (p.id === personId ? updated : p)) };
}
