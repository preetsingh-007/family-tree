/** Deterministic random family generator for property-based layout tests (synthetic names only). */
import { addParentLink, addPartnership, addPerson, createEmptyTree, createPerson } from '../model/tree';
import type { FamilyTreeDocument, Id, ParentLinkKind } from '../model/types';

/** Small seeded PRNG (mulberry32) so failures are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a multi-generation family with the awkward cases real families have:
 * remarriage, children with different partners, single parents, adoption,
 * partners marrying in from other families, cousin marriages, and pairs of
 * siblings marrying pairs of siblings.
 */
export function randomFamily(seed: number, generations = 4): { tree: FamilyTreeDocument; people: Id[] } {
  const random = rng(seed);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]!;
  let tree: FamilyTreeDocument = createEmptyTree(`Random ${seed}`);
  let counter = 0;
  const newPerson = () => {
    const p = createPerson({ givenNames: `P${counter++}`, surname: 'Rand', sex: random() < 0.5 ? 'male' : 'female' });
    tree = addPerson(tree, p);
    return p.id;
  };
  const couple = (a: Id, b: Id) => {
    tree = addPartnership(tree, a, b, 'marriage');
  };
  const child = (parents: Id[], kind: ParentLinkKind = 'biological') => {
    const c = newPerson();
    for (const p of parents) tree = addParentLink(tree, p, c, kind);
    return c;
  };

  let generation: Id[] = [newPerson(), newPerson(), newPerson(), newPerson()];
  couple(generation[0]!, generation[1]!);
  couple(generation[2]!, generation[3]!);
  const couples: [Id, Id][] = [
    [generation[0]!, generation[1]!],
    [generation[2]!, generation[3]!],
  ];
  for (let g = 1; g < generations; g++) {
    const next: Id[] = [];
    for (const [a, b] of couples.splice(0)) {
      const count = Math.floor(random() * 4);
      for (let i = 0; i < count; i++) next.push(child([a, b], random() < 0.1 ? 'adoptive' : 'biological'));
      if (random() < 0.25) {
        // Remarriage with children from the new partnership.
        const other = newPerson();
        couple(a, other);
        next.push(child([a, other]));
      }
      if (random() < 0.15) next.push(child([b])); // single-parent child
    }
    // Pair people of this generation: mostly with newcomers, sometimes with each other (cousins / sibling pairs).
    const pool = [...next];
    while (pool.length) {
      const a = pool.splice(Math.floor(random() * pool.length), 1)[0]!;
      if (random() < 0.3) continue; // stays single
      let b: Id;
      if (pool.length && random() < 0.3) b = pool.splice(Math.floor(random() * pool.length), 1)[0]!;
      else b = newPerson();
      couple(a, b);
      couples.push([a, b]);
    }
    if (!couples.length && next.length) {
      const a = pick(next);
      const b = newPerson();
      couple(a, b);
      couples.push([a, b]);
    }
    generation = next;
  }
  return { tree, people: tree.people.map((p) => p.id) };
}

/**
 * A family shaped like most real ones: several children per couple, most of
 * whom marry into other families (who arrive with their own parents and
 * siblings), with occasional remarriage and adoption.
 */
export function realisticFamily(seed: number, generations = 4): { tree: FamilyTreeDocument; people: Id[] } {
  const random = rng(seed);
  let tree: FamilyTreeDocument = createEmptyTree(`Realistic ${seed}`);
  let counter = 0;
  const newPerson = (sex: 'male' | 'female') => {
    const p = createPerson({ givenNames: `R${counter++}`, surname: 'Real', sex });
    tree = addPerson(tree, p);
    return p.id;
  };
  const other = (sex: 'male' | 'female') => (sex === 'male' ? 'female' : 'male');
  const kidsCount = () => [1, 2, 2, 3, 3, 3, 4, 5][Math.floor(random() * 8)]!;
  const children = (a: Id, b: Id | undefined, count: number) => {
    const kids: { id: Id; sex: 'male' | 'female' }[] = [];
    for (let i = 0; i < count; i++) {
      const sex = random() < 0.5 ? 'male' : 'female';
      const c = newPerson(sex);
      const kind = random() < 0.03 ? 'adoptive' : 'biological';
      tree = addParentLink(tree, a, c, kind);
      if (b) tree = addParentLink(tree, b, c, kind);
      kids.push({ id: c, sex });
    }
    return kids;
  };
  /** A spouse from another family, sometimes with that family's parents and siblings. */
  const spouseFor = (sex: 'male' | 'female') => {
    const spouse = newPerson(sex);
    if (random() < 0.6) {
      const f = newPerson('male');
      const m = newPerson('female');
      tree = addPartnership(tree, f, m, 'marriage');
      tree = addParentLink(addParentLink(tree, f, spouse), m, spouse);
      for (const s of children(f, m, Math.floor(random() * 3))) {
        if (random() < 0.4) {
          const sp = newPerson(other(s.sex));
          tree = addPartnership(tree, s.id, sp, 'marriage');
          children(s.id, sp, Math.floor(random() * 3));
        }
      }
    }
    return spouse;
  };

  const founder = newPerson('male');
  const founderSpouse = newPerson('female');
  tree = addPartnership(tree, founder, founderSpouse, 'marriage');
  let couples: [Id, Id][] = [[founder, founderSpouse]];
  for (let g = 1; g < generations; g++) {
    const next: [Id, Id][] = [];
    for (const [a, b] of couples) {
      for (const kid of children(a, b, kidsCount())) {
        if (random() < 0.8) {
          const spouse = spouseFor(other(kid.sex));
          tree = addPartnership(tree, kid.id, spouse, 'marriage');
          next.push([kid.id, spouse]);
          if (random() < 0.05) {
            const second = spouseFor(other(kid.sex));
            tree = addPartnership(tree, kid.id, second, 'marriage');
            children(kid.id, second, 1);
          }
        }
      }
    }
    couples = next;
  }
  return { tree, people: tree.people.map((p) => p.id) };
}
