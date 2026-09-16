import type { SourceRow } from "./source-search.js";

/**
 * Navigating sources by folder.
 *
 * Sources used to be one flat list. A long source is best split — every
 * operation stores a full copy of the document's state, so a book-sized one
 * makes every later write to it expensive — but splitting leaves twenty loose
 * chapters with nothing saying they are one book. `POST sources/folders`
 * groups them; this decides what the list shows once they are grouped.
 *
 * Pure, and tested, because it is the part with rules: which folders belong to
 * /sources, what a folder's count means, where the breadcrumb goes, and what
 * happens when the tree and the row list disagree.
 */

export type TreeNode = {
  id: string;
  name: string;
  kind: "file" | "folder";
  documentType?: string;
  parentFolder: string | null;
};

export interface SourceFolder {
  id: string;
  name: string;
  /** Sources anywhere beneath it — a book with parts still reads as one. */
  count: number;
}

export interface SourceView {
  folders: SourceFolder[];
  sources: SourceRow[];
  /** Root first; `id: null` is /sources itself. */
  breadcrumb: { id: string | null; name: string }[];
}

const ROOT_LABEL = "Sources";
const SOURCES_FOLDER = "sources";

/** The `/sources` folder: a top-level folder of that name. */
function sourcesRootOf(nodes: TreeNode[]): TreeNode | undefined {
  return nodes.find(
    (n) => n.kind === "folder" && !n.parentFolder && n.name === SOURCES_FOLDER,
  );
}

function childFolders(nodes: TreeNode[], parentId: string): TreeNode[] {
  return nodes.filter((n) => n.kind === "folder" && n.parentFolder === parentId);
}

/** Every folder id at or beneath `folderId`, cycle-safe. */
function subtree(nodes: TreeNode[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const child of childFolders(nodes, current)) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

export function sourceView(
  rows: SourceRow[],
  nodes: TreeNode[],
  folderId: string | null,
  options: { flatten?: boolean } = {},
): SourceView {
  const root = sourcesRootOf(nodes);
  // No /sources folder, or a search is running: one flat list. A match hidden
  // behind a folder reads as a search that does not work — the same reason the
  // status groups all open when a query is active.
  if (!root || options.flatten) {
    return { folders: [], sources: rows, breadcrumb: [{ id: null, name: ROOT_LABEL }] };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A folder deleted while open would otherwise leave a breadcrumb pointing at
  // nothing and an empty list that looks like data loss.
  const open =
    folderId && byId.get(folderId)?.kind === "folder" ? folderId : null;
  const currentId = open ?? root.id;

  const parentOf = (row: SourceRow): string | null =>
    byId.get(row.id)?.parentFolder ?? null;

  const folders = childFolders(nodes, currentId)
    .map((folder) => {
      const beneath = subtree(nodes, folder.id);
      return {
        id: folder.id,
        name: folder.name,
        count: rows.filter((r) => {
          const parent = parentOf(r);
          return parent !== null && beneath.has(parent);
        }).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const sources = rows.filter((r) => {
    const parent = parentOf(r);
    // A row the tree has not caught up with belongs at the root rather than
    // nowhere: the two are fetched separately and can disagree briefly.
    if (parent === null) return currentId === root.id;
    return parent === currentId;
  });

  const trail: { id: string | null; name: string }[] = [];
  let walk: string | null = open;
  const seen = new Set<string>();
  while (walk && walk !== root.id && !seen.has(walk)) {
    seen.add(walk);
    const node = byId.get(walk);
    if (!node) break;
    trail.unshift({ id: node.id, name: node.name });
    walk = node.parentFolder;
  }
  return {
    folders,
    sources,
    breadcrumb: [{ id: null, name: ROOT_LABEL }, ...trail],
  };
}
