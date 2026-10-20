/**
 * The folders above a drive node, outermost first.
 *
 * The Tree tab keeps each folder's open state in memory, and that memory is
 * gone after a page reload — or whenever the tree mounts fresh. Without this,
 * the selected document is still *selected* but hidden inside collapsed
 * folders, and the user has to hunt for it. Opening its ancestors is what
 * makes the selection visible.
 *
 * The drive tree and the selection are read separately and can briefly
 * disagree, so an id the tree does not know yields `[]`, and a parent chain
 * that loops stops where it would repeat rather than spinning forever.
 */
export function ancestorFolderIds(
  nodes: readonly { id: string; parentFolder?: string | null }[],
  id: string | null | undefined,
): string[] {
  if (!id) return [];
  const parentOf = new Map<string, string | null>();
  for (const node of nodes) parentOf.set(node.id, node.parentFolder ?? null);

  const path: string[] = [];
  const seen = new Set<string>([id]);
  let walk = parentOf.get(id) ?? null;
  while (walk !== null && !seen.has(walk)) {
    seen.add(walk);
    path.unshift(walk);
    walk = parentOf.get(walk) ?? null;
  }
  return path;
}
