/**
 * Read-only queries over a tree, backed by an index that is rebuilt whenever
 * the document changes. Siblings and step-relations are derived here rather
 * than stored.
 */
import { comparePeopleByName } from './names';
import type { Association, FamilyTreeDocument, Id, MediaItem, ParentLink, Partnership, Person } from './types';

export interface TreeIndex {
  tree: FamilyTreeDocument;
  people: Map<Id, Person>;
  media: Map<Id, MediaItem>;
  linksByChild: Map<Id, ParentLink[]>;
  linksByParent: Map<Id, ParentLink[]>;
  partnershipsByPerson: Map<Id, Partnership[]>;
  associationsByPerson: Map<Id, Association[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildIndex(tree: FamilyTreeDocument): TreeIndex {
  const index: TreeIndex = {
    tree,
    people: new Map(tree.people.map((p) => [p.id, p])),
    media: new Map(tree.media.map((m) => [m.id, m])),
    linksByChild: new Map(),
    linksByParent: new Map(),
    partnershipsByPerson: new Map(),
    associationsByPerson: new Map(),
  };
  for (const link of tree.parentLinks) {
    push(index.linksByChild, link.childId, link);
    push(index.linksByParent, link.parentId, link);
  }
  for (const partnership of tree.partnerships) {
    push(index.partnershipsByPerson, partnership.partnerIds[0], partnership);
    if (partnership.partnerIds[1] !== partnership.partnerIds[0]) {
      push(index.partnershipsByPerson, partnership.partnerIds[1], partnership);
    }
  }
  for (const association of tree.associations) {
    push(index.associationsByPerson, association.personIds[0], association);
    push(index.associationsByPerson, association.personIds[1], association);
  }
  return index;
}

export interface ParentRelation {
  person: Person;
  link: ParentLink;
}

export interface PartnerRelation {
  person: Person;
  partnership: Partnership;
}

export type SiblingKind = 'full' | 'half' | 'step';

export interface SiblingRelation {
  person: Person;
  kind: SiblingKind;
}

export interface StepParentRelation {
  person: Person;
  /** The parent through whom the step-relationship exists. */
  via: Person;
}

export interface AssociationRelation {
  person: Person;
  association: Association;
  /** True when the current person is the first person in the association. */
  outgoing: boolean;
}

function byName<T extends { person: Person }>(a: T, b: T) {
  return comparePeopleByName(a.person, b.person);
}

function byBirth(a: Person, b: Person): number {
  const ay = a.birth?.date?.year;
  const by = b.birth?.date?.year;
  if (ay !== undefined && by !== undefined && ay !== by) return ay - by;
  if (ay !== undefined && by === undefined) return -1;
  if (ay === undefined && by !== undefined) return 1;
  return comparePeopleByName(a, b);
}

export function getParents(index: TreeIndex, id: Id): ParentRelation[] {
  return (index.linksByChild.get(id) ?? [])
    .map((link) => ({ link, person: index.people.get(link.parentId) }))
    .filter((r): r is ParentRelation => !!r.person)
    .sort(byName);
}

export function getChildren(index: TreeIndex, id: Id): ParentRelation[] {
  return (index.linksByParent.get(id) ?? [])
    .map((link) => ({ link, person: index.people.get(link.childId) }))
    .filter((r): r is ParentRelation => !!r.person)
    .sort((a, b) => byBirth(a.person, b.person));
}

export function getPartners(index: TreeIndex, id: Id): PartnerRelation[] {
  return (index.partnershipsByPerson.get(id) ?? [])
    .map((partnership) => {
      const otherId = partnership.partnerIds[0] === id ? partnership.partnerIds[1] : partnership.partnerIds[0];
      return { partnership, person: index.people.get(otherId) };
    })
    .filter((r): r is PartnerRelation => !!r.person)
    .sort((a, b) => (a.partnership.start?.date?.year ?? Infinity) - (b.partnership.start?.date?.year ?? Infinity) || byName(a, b));
}

/** Parent ids through non-step links; step links do not make people siblings. */
function lineageParentIds(index: TreeIndex, id: Id): Set<Id> {
  return new Set((index.linksByChild.get(id) ?? []).filter((l) => l.kind !== 'step').map((l) => l.parentId));
}

export function getSiblings(index: TreeIndex, id: Id): SiblingRelation[] {
  const myParents = lineageParentIds(index, id);
  const result = new Map<Id, SiblingKind>();

  for (const parentId of myParents) {
    for (const link of index.linksByParent.get(parentId) ?? []) {
      if (link.childId === id || link.kind === 'step' || result.has(link.childId)) continue;
      const theirParents = lineageParentIds(index, link.childId);
      const full = theirParents.size === myParents.size && [...myParents].every((p) => theirParents.has(p));
      result.set(link.childId, full ? 'full' : 'half');
    }
  }

  // Step-siblings: children of a parent's partner who share no parent with this person.
  for (const parentId of myParents) {
    for (const partnership of index.partnershipsByPerson.get(parentId) ?? []) {
      const stepParentId = partnership.partnerIds[0] === parentId ? partnership.partnerIds[1] : partnership.partnerIds[0];
      if (myParents.has(stepParentId)) continue;
      for (const link of index.linksByParent.get(stepParentId) ?? []) {
        if (link.childId !== id && !result.has(link.childId)) result.set(link.childId, 'step');
      }
    }
  }

  return [...result.entries()]
    .map(([siblingId, kind]) => ({ person: index.people.get(siblingId), kind }))
    .filter((r): r is SiblingRelation => !!r.person)
    .sort((a, b) => byBirth(a.person, b.person));
}

/**
 * Partners of a parent who are not themselves recorded as a parent.
 * (Explicit "step" parent links are returned by getParents instead.)
 */
export function getDerivedStepParents(index: TreeIndex, id: Id): StepParentRelation[] {
  const parentIds = new Set((index.linksByChild.get(id) ?? []).map((l) => l.parentId));
  const result = new Map<Id, StepParentRelation>();
  for (const parentId of parentIds) {
    const via = index.people.get(parentId);
    if (!via) continue;
    for (const { person } of getPartners(index, parentId)) {
      if (!parentIds.has(person.id) && person.id !== id && !result.has(person.id)) {
        result.set(person.id, { person, via });
      }
    }
  }
  return [...result.values()].sort(byName);
}

export function getAssociations(index: TreeIndex, id: Id): AssociationRelation[] {
  return (index.associationsByPerson.get(id) ?? [])
    .map((association) => {
      const outgoing = association.personIds[0] === id;
      const otherId = outgoing ? association.personIds[1] : association.personIds[0];
      return { association, outgoing, person: index.people.get(otherId) };
    })
    .filter((r): r is AssociationRelation => !!r.person)
    .sort(byName);
}

export interface ChildGroup {
  /** The other parent, or undefined for children with no other recorded parent. */
  coParent?: Person;
  partnership?: Partnership;
  children: ParentRelation[];
}

/** Groups a person's children by the other parent, so children of different relationships are clear. */
export function getChildGroups(index: TreeIndex, id: Id): ChildGroup[] {
  const groups = new Map<string, ChildGroup>();
  const partners = getPartners(index, id);
  for (const { person, partnership } of partners) {
    if (!groups.has(person.id)) groups.set(person.id, { coParent: person, partnership, children: [] });
  }
  for (const child of getChildren(index, id)) {
    const otherParents = getParents(index, child.person.id).filter((p) => p.person.id !== id);
    const coParent = otherParents.find((p) => groups.has(p.person.id))?.person ?? otherParents[0]?.person;
    const key = coParent?.id ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { coParent, children: [] };
      groups.set(key, group);
    }
    group.children.push(child);
  }
  return [...groups.values()].filter((g) => g.children.length > 0 || g.partnership);
}

export function getPortrait(index: TreeIndex, person: Person): MediaItem | undefined {
  const first = person.mediaIds[0];
  return first ? index.media.get(first) : undefined;
}
