/** Hidden-relative counts and collapsed families, shared by both layouts. */
import type { TreeIndex } from '../model/relatives';
import type { Id } from '../model/types';
import type { FamilyIndex } from './families';
import type { CollapsedFamily, LayoutNode } from './types';

export function relativeCounts(
  index: TreeIndex,
  families: FamilyIndex,
  drawn: ReadonlySet<Id>,
  echoed: ReadonlySet<Id>,
  collapsed: ReadonlySet<string>,
  nodes: LayoutNode[],
): { hiddenRelatives: Map<Id, number>; collapsedFamilies: CollapsedFamily[] } {
  const hiddenByCollapse = (child: Id) => collapsed.has(families.childFamily.get(child) ?? '');
  const hiddenRelatives = new Map<Id, number>();
  for (const id of drawn) {
    const seen = new Set<Id>();
    let hidden = 0;
    const consider = (other: Id, isChild: boolean) => {
      if (seen.has(other) || drawn.has(other) || echoed.has(other)) return;
      seen.add(other);
      // Children of collapsed families are shown again from the family's own control.
      if (isChild && hiddenByCollapse(other)) return;
      hidden++;
    };
    for (const p of index.partnershipsByPerson.get(id) ?? []) consider(p.partnerIds[0] === id ? p.partnerIds[1] : p.partnerIds[0], false);
    for (const l of index.linksByChild.get(id) ?? []) consider(l.parentId, false);
    for (const l of index.linksByParent.get(id) ?? []) consider(l.childId, true);
    if (hidden) hiddenRelatives.set(id, hidden);
  }

  const collapsedFamilies: CollapsedFamily[] = [];
  for (const key of collapsed) {
    const family = families.families.get(key);
    if (!family) continue;
    const parents = family.parents
      .map((id) => nodes.find((n) => n.person.id === id && !n.echo) ?? nodes.find((n) => n.person.id === id))
      .filter((n): n is LayoutNode => !!n)
      .map((n) => n.key);
    if (!parents.length) continue;
    const descendants = new Set<Id>();
    const stack = [...family.children];
    while (stack.length) {
      const c = stack.pop()!;
      if (descendants.has(c) || drawn.has(c)) continue;
      descendants.add(c);
      stack.push(...(index.linksByParent.get(c) ?? []).map((l) => l.childId));
    }
    if (descendants.size) collapsedFamilies.push({ key, parents, hidden: descendants.size });
  }
  return { hiddenRelatives, collapsedFamilies };
}
