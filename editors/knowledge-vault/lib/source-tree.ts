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
  /**
   * How those sources are split by status, e.g. `{ EXTRACTED: 2, INBOX: 1 }`.
   *
   * A folder cannot live inside one status group because it is not in one
   * status. Deriving a single one would lie — a twenty-chapter book with one
   * chapter left shows as INBOX and reads as untouched — and listing the
   * folder under every status it touches duplicates it. So the row stays
   * above the groups and says what is actually inside.
   */
  byStatus: Record<string, number>;
}

export interface SourceView {
  folders: SourceFolder[];
  sources: SourceRow[];
  /** Sources at or beneath the current folder — what the header counts. */
  total: number;
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
    return {
      folders: [],
      sources: rows,
      total: rows.length,
      breadcrumb: [{ id: null, name: ROOT_LABEL }],
    };
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
      const inside = rows.filter((r) => {
        const parent = parentOf(r);
        return parent !== null && beneath.has(parent);
      });
      const byStatus: Record<string, number> = {};
      for (const r of inside) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      return { id: folder.id, name: folder.name, count: inside.length, byStatus };
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
  // Everything reachable from here, not just this level: at the root that is
  // the whole vault, inside a book it is the book.
  const here = subtree(nodes, currentId);
  const total = rows.filter((r) => {
    const parent = parentOf(r);
    return parent === null ? currentId === root.id : here.has(parent);
  }).length;

  return {
    folders,
    sources,
    total,
    breadcrumb: [{ id: null, name: ROOT_LABEL }, ...trail],
  };
}

/**
 * The status tally as a phrase: "2 extracted · 1 inbox", or just
 * "3 extracted" when they all agree. Ordered by the pipeline, not by count,
 * so the same folder reads the same way from one render to the next.
 */
const STATUS_ORDER = ["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"];

export function describeStatuses(byStatus: Record<string, number>): string {
  const known = STATUS_ORDER.filter((s) => byStatus[s]);
  const rest = Object.keys(byStatus)
    .filter((s) => !STATUS_ORDER.includes(s))
    .sort();
  return [...known, ...rest]
    .map((s) => `${byStatus[s]} ${s.toLowerCase()}`)
    .join(" · ");
}

/**
 * Everything a folder delete must take with it.
 *
 * Deleting the folder node alone would leave its sources in the reactor with
 * nothing pointing at them — the state this vault is already in for nine test
 * sources, which answer `findDocuments` but appear in no drive. So the caller
 * deletes the documents first and the folder second.
 */
export function folderContents(
  nodes: TreeNode[],
  folderId: string,
): { folderIds: string[]; sourceIds: string[] } {
  const exists = nodes.some((n) => n.id === folderId && n.kind === "folder");
  if (!exists) return { folderIds: [], sourceIds: [] };
  const folderIds = [...subtree(nodes, folderId)];
  const within = new Set(folderIds);
  const sourceIds = nodes
    .filter(
      (n) =>
        n.kind === "file" &&
        n.documentType === "bai/source" &&
        n.parentFolder !== null &&
        within.has(n.parentFolder),
    )
    .map((n) => n.id);
  return { folderIds, sourceIds };
}

/* ── remembering where you were ──────────────────────────────────────────── */

const OPEN_FOLDER_KEY = "bai:sources-open-folder";

/**
 * The folder the Sources list was left in.
 *
 * Opening a source unmounts the list, so without this every visit to a
 * chapter sends you back to the root. Session-scoped: the place you were
 * reading is worth keeping across a reload, not across a week.
 */
export function readOpenFolder(): string | null {
  try {
    return sessionStorage.getItem(OPEN_FOLDER_KEY) || null;
  } catch {
    return null;
  }
}

export function writeOpenFolder(folderId: string | null): void {
  try {
    if (folderId) sessionStorage.setItem(OPEN_FOLDER_KEY, folderId);
    else sessionStorage.removeItem(OPEN_FOLDER_KEY);
  } catch {
    // Private mode or a full quota only costs the remembered position.
  }
}
