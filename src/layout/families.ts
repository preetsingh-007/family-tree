/**
 * "Family units": a set of parents together with their children. A child
 * belongs to exactly one unit (all of its recorded parents); a partnership
 * with no children is a unit with no children. Units are how the tree draws
 * parent–child lines, and how the focus layout decides what to attach where.
 */
import type { TreeIndex } from '../model/relatives';
import type { Id, ParentLinkKind, Partnership } from '../model/types';

export interface Family {
  key: string;
  /** Ordered: male before female where recorded, otherwise as entered. */
  parents: Id[];
  children: Id[];
  partnership?: Partnership;
  /** Whether each child's link is drawn dashed (adoptive, step, foster, guardian). */
  dashed: Map<Id, boolean>;
}

export interface FamilyIndex {
  families: Map<string, Family>;
  /** The unit in which each person is a child. */
  childFamily: Map<Id, string>;
  /** Units in which each person is a parent, earliest partnership first. */
  parentFamilies: Map<Id, string[]>;
}

const keyOf = (parents: Id[]) => [...parents].sort().join('|');

function isDashed(kinds: ParentLinkKind[]): boolean {
  return kinds.some((k) => k !== 'biological' && k !== 'unknown');
}

export function buildFamilies(index: TreeIndex): FamilyIndex {
  const families = new Map<string, Family>();
  const ensure = (parents: Id[]) => {
    const key = keyOf(parents);
    let family = families.get(key);
    if (!family) {
      family = { key, parents: orderParents(index, parents), children: [], dashed: new Map() };
      families.set(key, family);
    }
    return family;
  };

  for (const p of index.tree.partnerships) {
    if (!index.people.has(p.partnerIds[0]) || !index.people.has(p.partnerIds[1])) continue;
    const family = ensure([...p.partnerIds]);
    // With several partnerships between the same two people, an ongoing one wins.
    if (!family.partnership || (family.partnership.end && !p.end)) family.partnership = p;
  }

  const childFamily = new Map<Id, string>();
  for (const person of index.tree.people) {
    const links = index.linksByChild.get(person.id) ?? [];
    if (links.length === 0) continue;
    const family = ensure(links.map((l) => l.parentId));
    family.children.push(person.id);
    family.dashed.set(person.id, isDashed(links.map((l) => l.kind)));
    childFamily.set(person.id, family.key);
  }

  const parentFamilies = new Map<Id, string[]>();
  const startYear = (f: Family) => f.partnership?.start?.date?.year ?? Infinity;
  for (const family of [...families.values()].sort((a, b) => startYear(a) - startYear(b))) {
    const byBirth = (a: Id, b: Id) =>
      (index.people.get(a)?.birth?.date?.year ?? Infinity) - (index.people.get(b)?.birth?.date?.year ?? Infinity);
    family.children.sort(byBirth);
    for (const parent of family.parents) {
      const list = parentFamilies.get(parent);
      if (list) list.push(family.key);
      else parentFamilies.set(parent, [family.key]);
    }
  }
  return { families, childFamily, parentFamilies };
}

function orderParents(index: TreeIndex, parents: Id[]): Id[] {
  const rank = (id: Id) => {
    const sex = index.people.get(id)?.sex;
    return sex === 'male' ? 0 : sex === 'female' ? 2 : 1;
  };
  return [...parents].sort((a, b) => rank(a) - rank(b));
}
