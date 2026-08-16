import type { Goal } from "document-models/work-breakdown-structure/v1";

/** Depth-first order: parents before children, sibling order = current array order. */
export function rebuildDepthFirst(goals: Goal[]): Goal[] {
  const byParent = new Map<string | null, Goal[]>();
  for (const g of goals) {
    const key = g.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(g);
    byParent.set(key, list);
  }
  const out: Goal[] = [];
  const visit = (parentId: string | null) => {
    for (const g of byParent.get(parentId) ?? []) {
      out.push(g);
      visit(g.id);
    }
  };
  visit(null);
  for (const g of goals) if (!out.includes(g)) out.push(g); // orphan safety
  return out;
}

export function collectSubtreeIds(goals: Goal[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of goals) {
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
    }
  }
  return ids;
}
