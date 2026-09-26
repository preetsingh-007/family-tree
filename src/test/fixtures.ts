/**
 * Synthetic test data. All names are invented; no real family information is
 * used anywhere in the test suite. This module is only imported by tests and is
 * therefore never included in the production bundle.
 */
import { addParentLink, addPartnership, addPerson, createEmptyTree, createPerson } from '../model/tree';
import type { FamilyTreeDocument, Person } from '../model/types';

export function person(givenNames: string, surname: string, extra: Partial<Person> = {}): Person {
  return createPerson({ givenNames, surname, ...extra });
}

/**
 * A deliberately complex fictional family:
 *
 *   Arthur Testfield ═(1) Beatrice Oldham (divorced)      Arthur ═(2) Clara Newbury
 *          │                                                     │
 *    ┌─────┴─────┐                                         Frank (half-sibling of Dora & Ed)
 *   Dora        Ed ═ Gina Sample
 *                      │
 *                 Hana (adopted by Ed and Gina)
 *
 *   Clara brought Ivo (from an earlier relationship) → step-child of Arthur.
 */
export function complexFamily() {
  const arthur = person('Arthur', 'Testfield', { birth: { date: { qualifier: 'about', year: 1920 } } });
  const beatrice = person('Beatrice', 'Oldham', { alternateNames: [{ name: 'Beatrice Testfield', type: 'married' }] });
  const clara = person('Clara', 'Newbury');
  const dora = person('Dora', 'Testfield', { birth: { date: { qualifier: 'exact', year: 1945, month: 3, day: 12 }, place: 'Exampleton' } });
  const ed = person('Ed', 'Testfield', { birth: { date: { qualifier: 'exact', year: 1948 } } });
  const frank = person('Frank', 'Testfield', { birth: { date: { qualifier: 'exact', year: 1960 } } });
  const gina = person('Gina', 'Sample');
  const hana = person('Hana', 'Testfield');
  const ivo = person('Ivo', 'Newbury');

  let tree: FamilyTreeDocument = createEmptyTree('Testfield family');
  for (const p of [arthur, beatrice, clara, dora, ed, frank, gina, hana, ivo]) tree = addPerson(tree, p);
  tree = addPartnership(tree, arthur.id, beatrice.id, 'marriage', 'p-ab');
  tree = {
    ...tree,
    partnerships: tree.partnerships.map((p) => (p.id === 'p-ab' ? { ...p, end: { reason: 'divorce' as const } } : p)),
  };
  tree = addPartnership(tree, arthur.id, clara.id, 'marriage', 'p-ac');
  tree = addPartnership(tree, ed.id, gina.id, 'marriage', 'p-eg');
  tree = addParentLink(tree, arthur.id, dora.id);
  tree = addParentLink(tree, beatrice.id, dora.id);
  tree = addParentLink(tree, arthur.id, ed.id);
  tree = addParentLink(tree, beatrice.id, ed.id);
  tree = addParentLink(tree, arthur.id, frank.id);
  tree = addParentLink(tree, clara.id, frank.id);
  tree = addParentLink(tree, clara.id, ivo.id);
  tree = addParentLink(tree, ed.id, hana.id, 'adoptive');
  tree = addParentLink(tree, gina.id, hana.id, 'adoptive');

  return { tree, arthur, beatrice, clara, dora, ed, frank, gina, hana, ivo };
}
