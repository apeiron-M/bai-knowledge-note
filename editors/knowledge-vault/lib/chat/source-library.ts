/**
 * The vault's sources as the chat sees them: how many, of what kind, and
 * where — the folders under /sources and what each holds.
 *
 * Sources are not in the graph index, so none of the graph tools can count
 * them, and `list_documents` only knows titles. Asked "how many sources are
 * there, what kinds, in which folders", the chat had nothing to answer from.
 * This is that answer, built from the two things the Sources view itself
 * reads: the drive tree (folders, and where each source sits) and the source
 * documents (status, kind, original file, notes extracted).
 *
 * The folder rules are the Sources view's (`sourceView` in source-tree.ts):
 * same root, same counts, same order — a folder the chat says holds twelve
 * sources holds twelve on screen. Pure, so the counting is tested without a
 * network.
 */
import { fileFamilyOf } from "../intake-model.js";
import {
  matchesSource,
  normalizeQuery,
  toSourceRow,
  type SourceRow,
} from "../source-search.js";
import { sourceView, type TreeNode } from "../source-tree.js";

/** One source document as the reactor returns it: header fields and its global state. */
export interface SourceDocument {
  id: string;
  name: string;
  createdAtUtcIso?: string;
  lastModifiedAtUtcIso?: string;
  global: Record<string, unknown>;
}

/** One source, as a tool result row. `documentId` + `title` make it citable. */
export interface LibrarySource {
  documentId: string;
  title: string;
  documentType: "bai/source";
  /** What the source is about, shortened; read_document has the text. */
  description: string | null;
  status: string;
  /** What the material is: ARTICLE, PAPER, BOOK_CHAPTER, … — null when never set. */
  sourceType: string | null;
  /** The original file's family — "PDF", "Word", … — or null when there is none. */
  fileType: string | null;
  originalFileName: string | null;
  /** How many notes were extracted from it. */
  claimCount: number;
  author: string | null;
  url: string | null;
  createdAt: string | null;
  extractedAt: string | null;
  /** Where it sits: a path under /sources ("" is /sources itself), or "/…" outside it. */
  folder: string;
}

/** A folder under /sources. Not a document: `folderId` is never a citation. */
export interface LibraryFolder {
  folderId: string;
  name: string;
  /** Path under /sources, e.g. "AI Reports/State of AI 2026". */
  path: string;
  /** Sources anywhere beneath it. */
  sources: number;
  byStatus: Record<string, number>;
  /** Folders directly inside it. */
  subfolders: number;
}

export interface SourceLibrary {
  rows: SourceRow[];
  byId: Map<string, LibrarySource>;
  nodes: TreeNode[];
}

const MIME_FAMILIES: Partial<Record<string, string>> = {
  "application/pdf": "PDF",
  "text/markdown": "Markdown",
  "text/x-markdown": "Markdown",
  "text/html": "web pages",
  "text/plain": "plain text",
  "message/rfc822": "email",
};

/** Extensions the intake's families do not name but a reader would. */
const EXTENSION_FAMILIES: Partial<Record<string, string>> = {
  eml: "email",
  msg: "email",
  txt: "plain text",
  csv: "CSV",
};

/** The original file's family, from its name first and its MIME type second. */
export function fileTypeOf(global: Record<string, unknown>): string | null {
  const name = typeof global.originalFileName === "string" ? global.originalFileName : "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const fromName = name ? (fileFamilyOf(name) ?? EXTENSION_FAMILIES[ext] ?? null) : null;
  if (fromName) return fromName;
  const mime =
    typeof global.originalMimeType === "string"
      ? global.originalMimeType.toLowerCase().split(";")[0].trim()
      : "";
  if (mime) return MIME_FAMILIES[mime] ?? (mime.startsWith("image/") ? "images" : mime);
  // An extension nobody named still says more than nothing.
  return ext || null;
}

const SOURCES_FOLDER = "sources";

function sourcesRoot(nodes: TreeNode[]): TreeNode | undefined {
  return nodes.find((n) => n.kind === "folder" && !n.parentFolder && n.name === SOURCES_FOLDER);
}

/**
 * A folder's path: relative to /sources when it is inside it ("" for /sources
 * itself), absolute ("/inbox") when it is not. Cycle-safe.
 */
function folderPath(nodes: Map<string, TreeNode>, rootId: string | null, folderId: string | null): string {
  if (folderId === null) return "/";
  const parts: string[] = [];
  const seen = new Set<string>();
  let walk: string | null = folderId;
  while (walk && !seen.has(walk)) {
    seen.add(walk);
    if (walk === rootId) return parts.reverse().join("/");
    const node = nodes.get(walk);
    if (!node) break;
    parts.push(node.name);
    walk = node.parentFolder;
  }
  return `/${parts.reverse().join("/")}`;
}

/** Long enough to say what a source is about; the text itself is read_document's job. */
const DESCRIPTION_CHARS = 240;
function shorten(text: string | null): string | null {
  if (!text) return null;
  return text.length > DESCRIPTION_CHARS ? `${text.slice(0, DESCRIPTION_CHARS).trimEnd()}…` : text;
}

/** Natural order, so "Part 2" comes before "Part 10". */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * The vault's sources: every document the tree lists as a `bai/source` that
 * the reactor returned. A document the reactor returned but the tree does not
 * list was deleted from the vault and is left out, as everywhere else.
 */
export function buildSourceLibrary(nodes: TreeNode[], documents: SourceDocument[]): SourceLibrary {
  const inTree = new Set(nodes.filter((n) => n.kind === "file").map((n) => n.id));
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const rootId = sourcesRoot(nodes)?.id ?? null;
  const rows: SourceRow[] = [];
  const byId = new Map<string, LibrarySource>();
  for (const doc of documents) {
    if (!inTree.has(doc.id)) continue;
    const row = toSourceRow(doc, doc.global);
    rows.push(row);
    const g = doc.global;
    byId.set(doc.id, {
      documentId: doc.id,
      title: row.title,
      documentType: "bai/source",
      description: shorten(row.description ?? null),
      status: row.status,
      sourceType: row.sourceType,
      fileType: fileTypeOf(g),
      originalFileName: typeof g.originalFileName === "string" && g.originalFileName ? g.originalFileName : null,
      claimCount: row.claimCount,
      author: row.author ?? null,
      url: row.url ?? null,
      createdAt: row.createdAt,
      extractedAt: row.extractedAt,
      folder: folderPath(byNode, rootId, byNode.get(doc.id)?.parentFolder ?? null),
    });
  }
  rows.sort((a, b) => byName(byId.get(a.id)!.folder, byId.get(b.id)!.folder) || byName(a.title, b.title));
  return { rows, byId, nodes };
}

function tally(values: (string | null)[], none: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v ?? none] = (out[v ?? none] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || byName(a[0], b[0])));
}

function foldersAt(lib: SourceLibrary, folderId: string | null): LibraryFolder[] {
  const byNode = new Map(lib.nodes.map((n) => [n.id, n]));
  const rootId = sourcesRoot(lib.nodes)?.id ?? null;
  return sourceView(lib.rows, lib.nodes, folderId).folders.map((f) => ({
    folderId: f.id,
    name: f.name,
    path: folderPath(byNode, rootId, f.id),
    sources: f.count,
    byStatus: f.byStatus,
    subfolders: lib.nodes.filter((n) => n.kind === "folder" && n.parentFolder === f.id).length,
  }));
}

/** Every folder at any depth beneath `folderId` (null: /sources), in path order. */
function allFoldersBeneath(lib: SourceLibrary, folderId: string | null): LibraryFolder[] {
  const out: LibraryFolder[] = [];
  const seen = new Set<string>();
  const walk = (id: string | null) => {
    for (const f of foldersAt(lib, id)) {
      if (seen.has(f.folderId)) continue;
      seen.add(f.folderId);
      out.push(f);
      walk(f.folderId);
    }
  };
  walk(folderId);
  return out;
}

/** A source as search sees it: its own fields, with the folder it sits in. */
function searchable<T extends { description?: string | null }>(row: T, folder: string): T {
  return { ...row, description: [row.description, folder].filter(Boolean).join("\n") };
}

export interface SourcesOverview {
  total: number;
  byStatus: Record<string, number>;
  /** What the material is (ARTICLE, PAPER, …); "not set" when a source never got one. */
  bySourceType: Record<string, number>;
  /** The original files' families (PDF, Word, …); "no original file" for pasted or typed text. */
  byFileType: Record<string, number>;
  /** Notes extracted from all of them. */
  notesExtracted: number;
  /** The folders directly under /sources, each with the sources beneath it. */
  folders: LibraryFolder[];
  /** Every folder beneath /sources, at any depth. */
  folderCount: number;
  /** Sources directly in /sources, in no folder. */
  inSourcesRoot: number;
  /** Sources the tree keeps somewhere other than /sources. */
  outsideSources: number;
}

/** Totals, kinds and top-level folders: the answer to "what sources does this vault hold?". */
export function summarizeSources(lib: SourceLibrary): SourcesOverview {
  const all = [...lib.byId.values()];
  const rootId = sourcesRoot(lib.nodes)?.id ?? null;
  let folderCount = 0;
  if (rootId) {
    const queue = [rootId];
    const seen = new Set(queue);
    while (queue.length) {
      const current = queue.pop()!;
      for (const n of lib.nodes) {
        if (n.kind !== "folder" || n.parentFolder !== current || seen.has(n.id)) continue;
        seen.add(n.id);
        folderCount++;
        queue.push(n.id);
      }
    }
  }
  return {
    total: all.length,
    byStatus: tally(all.map((s) => s.status), "INBOX"),
    bySourceType: tally(all.map((s) => s.sourceType), "not set"),
    byFileType: tally(all.map((s) => s.fileType), "no original file"),
    notesExtracted: all.reduce((sum, s) => sum + s.claimCount, 0),
    folders: rootId ? foldersAt(lib, null) : [],
    folderCount,
    inSourcesRoot: all.filter((s) => s.folder === "").length,
    outsideSources: all.filter((s) => s.folder.startsWith("/")).length,
  };
}

export interface BrowseOptions {
  /** A folderId, a path under /sources ("AI Reports/2026"), or a folder's name. Empty: /sources. */
  folder?: string | null;
  /** Every source beneath the folder, not only those directly in it. */
  recursive?: boolean;
  status?: string | null;
  sourceType?: string | null;
  /** Words to find in title, description, author or url — searches beneath the folder. */
  query?: string | null;
  limit: number;
}

export type BrowseResult =
  | {
      ok: true;
      folder: { folderId: string | null; name: string; path: string };
      /** From /sources down to this folder. */
      breadcrumb: string[];
      subfolders: LibraryFolder[];
      sources: LibrarySource[];
      /** Sources matching, before the limit. */
      matched: number;
      /** Sources at or beneath this folder, unfiltered. */
      totalBeneath: number;
    }
  | { ok: false; error: string };

const norm = (s: string) => s.trim().replace(/^\/+|\/+$/g, "").toLowerCase();

/** The folder a model named, by id, path or name — or why it could not be found. */
function resolveFolder(lib: SourceLibrary, raw: string): { id: string | null } | { error: string } {
  const rootId = sourcesRoot(lib.nodes)?.id ?? null;
  const wanted = norm(raw).replace(/^sources(\/|$)/, "");
  if (!wanted) return { id: null };
  const byNode = new Map(lib.nodes.map((n) => [n.id, n]));
  const folders = lib.nodes.filter((n) => n.kind === "folder" && n.id !== rootId);
  const byIdMatch = folders.find((f) => f.id === raw.trim());
  if (byIdMatch) return { id: byIdMatch.id };
  const withPath = folders.map((f) => ({ f, path: folderPath(byNode, rootId, f.id) }));
  const byPath = withPath.find((x) => norm(x.path) === wanted);
  if (byPath) return { id: byPath.f.id };
  const byNameMatches = withPath.filter((x) => x.f.name.trim().toLowerCase() === wanted);
  if (byNameMatches.length === 1) return { id: byNameMatches[0].f.id };
  if (byNameMatches.length > 1) {
    return {
      error: `"${raw}" names ${byNameMatches.length} folders: ${byNameMatches.map((x) => x.path).join("; ")}. Pass one of these paths.`,
    };
  }
  const top = foldersAt(lib, null).map((f) => f.path);
  return {
    error: `No folder "${raw}" under /sources.${top.length ? ` The folders there are: ${top.join("; ")}.` : " /sources has no folders."}`,
  };
}

/** One folder's subfolders and sources, filtered — what `list_sources` returns. */
export function browseSources(lib: SourceLibrary, o: BrowseOptions): BrowseResult {
  const resolved = resolveFolder(lib, o.folder ?? "");
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const view = sourceView(lib.rows, lib.nodes, resolved.id);
  const byNode = new Map(lib.nodes.map((n) => [n.id, n]));
  const rootId = sourcesRoot(lib.nodes)?.id ?? null;
  const here = resolved.id === null ? "" : folderPath(byNode, rootId, resolved.id);

  // The library's order — by folder, then naturally by title — not fetch order.
  const all = lib.rows.map((r) => lib.byId.get(r.id)).filter((s): s is LibrarySource => s !== undefined);
  const beneath = all.filter((s) =>
    resolved.id === null ? true : s.folder === here || s.folder.startsWith(`${here}/`),
  );
  const direct = new Set(view.sources.map((r) => r.id));
  // Search the full row — the whole description — not the shortened copy.
  const rowById = new Map(lib.rows.map((r) => [r.id, r]));
  const terms = o.query ? normalizeQuery(o.query) : [];
  const status = o.status?.trim().toUpperCase() || null;
  const kind = o.sourceType?.trim().toUpperCase() || null;
  const pool = o.recursive || terms.length > 0 ? beneath : all.filter((s) => direct.has(s.documentId));
  const matching = pool.filter(
    (s) =>
      (!status || s.status === status) &&
      (!kind || s.sourceType === kind) &&
      (terms.length === 0 || matchesSource(searchable(rowById.get(s.documentId) ?? s, s.folder), terms)),
  );
  // A search also names the folders that match: a document split into parts
  // carries its own name only on its folder — its parts are "Conclusion",
  // "Part 3" — so the folder is often the answer.
  const subfolders =
    terms.length > 0
      ? allFoldersBeneath(lib, resolved.id).filter((f) => {
          const hay = f.path.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
      : foldersAt(lib, resolved.id);
  return {
    ok: true,
    folder: {
      folderId: resolved.id,
      name: resolved.id === null ? "Sources" : (byNode.get(resolved.id)?.name ?? here),
      path: here,
    },
    breadcrumb: view.breadcrumb.map((b) => b.name),
    subfolders,
    sources: matching.slice(0, o.limit),
    matched: matching.length,
    totalBeneath: beneath.length,
  };
}
