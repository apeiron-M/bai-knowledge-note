/**
 * The chat's tool surface over the vault: nine read-only queries.
 *
 * Read-only is enforced structurally, not by instruction. `executeTool` is a
 * fixed switch over these nine names; there is no path from a model-supplied
 * string to an arbitrary GraphQL operation, and no mutation appears anywhere
 * in this file.
 *
 * Two constraints from measuring the subgraph shaped every projection:
 *
 *  - `KnowledgeGraphNode.topics` is a per-node field resolver — selecting it
 *    on an N-row result issues N extra queries. It is only ever selected on a
 *    single-node read.
 *  - `content` is never truncated server-side. A search of 8 hits costs ~800
 *    tokens without it and ~2,600 with it, so list tools project it away and
 *    the model fetches bodies deliberately through `read_note`.
 *
 * Several graph queries have no server-side limit (`knowledgeGraphTopics`
 * returns all 600+ topics), so caps are applied client-side here.
 *
 * Every tool returns a one-line `summary` for the reading trail in the UI.
 */
import {
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
} from "../../../shared/subgraph-endpoint.js";
import { fetchDocumentState } from "../../../shared/document-state.js";
import type { WorkBreakdownStructureState } from "document-models/work-breakdown-structure";
import type { ToolSchema } from "./completions-client.js";
import { resolveEns, resolveEnsNames } from "./ens.js";
import {
  PAGE_MAX_CHARS,
  readUrl,
  readWebSettings,
  searchWeb,
} from "./web.js";
import { shortAddress } from "../../../shared/identity.js";
import { summarizeOperation } from "../../../../processors/graph-indexer/summarize.js";
import {
  renderScope,
  renderWbs,
  rollupDeliverables,
} from "../../../../processors/graph-indexer/work-outline.js";
import type { ScopeOfWorkState } from "document-models/scope-of-work";

export type ToolResult =
  | { ok: true; data: unknown; summary: string }
  | { ok: false; error: string };

export interface ToolContext {
  driveId: string;
}

/** Document models registered in `powerhouse.manifest.json`. */
export const DOCUMENT_TYPES = [
  "bai/source",
  "bai/knowledge-note",
  "bai/moc",
  "bai/tension",
  "bai/observation",
  "bai/research-claim",
  "bai/derivation",
  "bai/wbs",
  "powerhouse/scopeofwork",
  "bai/health-report",
  "bai/pipeline-queue",
  "bai/vault-config",
] as const;

const LIMITS = {
  search: { default: 8, max: 20 },
  topics: { default: 40, max: 100 },
  byTopic: { default: 25, max: 50 },
  related: { default: 8, max: 20 },
  links: 15,
  documents: { default: 50, max: 100 },
  recent: { default: 10, max: 50 },
  /** How many rows carry who/what: one extra request each, run in parallel. */
  recentDetail: 12,
  history: { default: 10, max: 50 },
  web: { default: 5, max: 10 },
  editors: { default: 10, max: 25 },
  activity: 5000,
  projects: 25,
  knowledgeRefTitles: 20,
  noteContent: 6000,
  documentWindow: 8000,
  metaString: 300,
  metaArray: 20,
} as const;

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

// `documentType` tells the model what kind of node a hit is: a knowledge
// note, a MoC, a research claim, or a tension / observation ABOUT the notes.
// Search ranks them together; the model should not cite a tension as a claim.
const NOTE_FIELDS =
  "documentId title description noteType status documentType";

/**
 * Looking outside the vault — see lib/chat/web.ts for how each is served
 * from a browser. Kept apart from `VAULT_TOOLS` because that list is also
 * what this package offers Connect's own assistant, which has its own tools
 * and its own policy about reaching the network.
 */
export const WEB_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Search the public web. Use ONLY when the vault does not hold the answer and the user wants outside information, or when they ask for something current (news, a release, today's documentation). Returns ranked results with title, url and a snippet; read_url fetches the full text of one. Web results are NOT vault knowledge: report them as outside the vault, cite them by their url as a markdown link, and never as [[documentId]].",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for, in plain words." },
          limit: {
            type: "integer",
            description: `Results to return (default ${LIMITS.web.default}, max ${LIMITS.web.max}).`,
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ens_lookup",
      description:
        "Resolve an Ethereum address to its ENS name, or an ENS name to its address — the same service the vault's own signer badges use, so a name here matches a name there. Use it whenever an address needs a person: document_history returns the signer's address, and this turns 0xadbA…BcA4 into a name. An address with no registered name comes back with name: null — report that plainly rather than searching the web for it.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "An address (0x…) or an ENS name (something.eth).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_url",
      description:
        "Fetch one public web page and return its text — plain JSON too, when the address is an API. Use after search_web to read a promising result, or when the user names a page. Give an address you actually saw in a result: invented API hostnames fail, and the failure says so. If the result carries a warning, the page is a 404 or an empty shell — it answered nothing, so say so rather than reporting what you hoped it said. Public http/https addresses only; long pages are truncated. Like search_web this is outside the vault — cite it by url, never as [[documentId]].",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full address, e.g. https://example.com/page." },
        },
        required: ["url"],
      },
    },
  },
];

export const VAULT_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "search_vault",
      description:
        "Default entry point. Semantic + keyword search over the vault's knowledge notes, maps of content, tensions, observations, scopes of work and work breakdowns. Pass the user's question or a short phrase as-is. Returns ranked hits with a 0–1 similarity; use read_note on the promising notes for their full text, and read_document on a hit whose status is SCOPE or WBS (a project or goal tree — its real state is in noteType). Does NOT search sources — use list_documents for those. ARCHIVED notes — claims the vault no longer holds as current — are excluded unless includeArchived is true; set it only when the user asks what the vault USED to say.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language question or key phrase.",
          },
          limit: {
            type: "integer",
            description: `Hits to return (default ${LIMITS.search.default}, max ${LIMITS.search.max}).`,
          },
          includeArchived: {
            type: "boolean",
            description: "Also return ARCHIVED notes (superseded or retired claims). Default false.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Read one knowledge note or map of content in full: body, topics, status, author. Use after search_vault to ground an answer in what the note actually says. Long bodies are truncated at 6,000 characters.",
      parameters: {
        type: "object",
        properties: {
          documentId: {
            type: "string",
            description: "The note's documentId from a previous result.",
          },
        },
        required: ["documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_topics",
      description:
        "The vault's topic vocabulary, most-used first. Use to discover what areas exist before drilling in with notes_by_topic.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: `Topics to return (default ${LIMITS.topics.default}, max ${LIMITS.topics.max}).`,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notes_by_topic",
      description:
        "All notes tagged with an exact topic name (case-sensitive; get names from list_topics). Use for 'what do we know about X' when X is a known topic.",
      parameters: {
        type: "object",
        properties: {
          includeArchived: {
            type: "boolean",
            description: "Also include ARCHIVED (retired) notes. Default false.",
          },
          topic: { type: "string", description: "Exact topic name." },
          limit: {
            type: "integer",
            description: `Notes to return (default ${LIMITS.byTopic.default}, max ${LIMITS.byTopic.max}).`,
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "related_notes",
      description:
        "Notes semantically closest to a given note (by embedding), whether or not they are linked. Use to widen a thread or find notes that say similar things.",
      parameters: {
        type: "object",
        properties: {
          includeArchived: {
            type: "boolean",
            description: "Also include ARCHIVED (retired) notes. Default false.",
          },
          documentId: { type: "string" },
          limit: {
            type: "integer",
            description: `Neighbours to return (default ${LIMITS.related.default}, max ${LIMITS.related.max}).`,
          },
        },
        required: ["documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "linked_notes",
      description:
        "Explicit graph links of a note in both directions: what it links to (outgoing) and what links to it (incoming), each with the link type (RELATES_TO, BUILDS_ON, CONTRADICTS, SUPERSEDES, DERIVED_FROM, CORE_IDEA, CHILD_MOC) and, when the author recorded one, the `reason` the link exists and a `confidence` (grounded, established, speculative). Use to follow an argument, find contradictions, or see which map of content owns a note.",
      parameters: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_changes",
      description:
        "What changed in the vault, newest first — one call answers who, what, when and where: each row carries the editor's ENS name and address, a phrase describing their last change, the time of it, and the document's title, type and documentId to cite. Covers every type (notes, maps of content, sources, scopes of work, work breakdowns, tensions, the health report, the queue). THE tool for 'what changed lately', 'what was last updated', 'what is new since <date>': never infer recency from the order of another list, and never answer it from an earlier turn. Optional documentType narrows to one kind; since (ISO date or date-time) bounds the window. Cite each row as [[documentId]]; document_history gives more of one document's history, read_note or read_document its contents.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: `Documents to return (default ${LIMITS.recent.default}, max ${LIMITS.recent.max}).`,
          },
          since: {
            type: "string",
            description: "Only documents edited at or after this ISO 8601 date or date-time, e.g. 2026-09-01 or 2026-09-01T00:00:00Z.",
          },
          documentType: {
            type: "string",
            enum: [...DOCUMENT_TYPES],
            description: "Only documents of this type, e.g. bai/source for the newest source material.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_history",
      description:
        "Who changed one document, when, and what they changed — the newest operations first, each with the editor's signing address, the app they used, and a phrase describing the change. Works for EVERY document type, indexed or not. Use after recent_changes to answer 'who made the last change', 'who wrote this', 'what was edited here'. It reports operations, not the document's content: read_note or read_document for what the document says now.",
      parameters: {
        type: "object",
        properties: {
          documentId: {
            type: "string",
            description: "The document's documentId, exactly as a previous result gave it.",
          },
          limit: {
            type: "integer",
            description: `Operations to return, newest first (default ${LIMITS.history.default}, max ${LIMITS.history.max}).`,
          },
        },
        required: ["documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vault_editors",
      description:
        "Who edits this vault, ranked by how many changes they made: each editor's ENS name where they have one, their signing address, the apps they edit through, how many documents they touched and when they were last active. THE tool for 'who works on this vault', 'who is the main author', 'who has been active lately'. Never count editors yourself from other results — this counts every recorded operation, and reports how many carry no signature at all.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: `Editors to return (default ${LIMITS.editors.default}, max ${LIMITS.editors.max}).`,
          },
          since: {
            type: "string",
            description: "Only operations at or after this ISO 8601 date or date-time.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vault_stats",
      description:
        "Size and shape of the vault: note count, link count, orphan count, graph density. Use for 'how big is this' or to sanity-check coverage.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_documents",
      description: `List documents of one type with their documentId and title. The graph index does not cover sources, so bai/source — the long-form material notes were extracted from — is reached through this tool and then read_document; the same goes for the health report, the pipeline queue and the vault config. Pass nameContains to find a document by title, e.g. a source the user could open when the notes do not answer. Every documentId returned is citable as [[documentId]]. Valid types: ${DOCUMENT_TYPES.join(", ")}.`,
      parameters: {
        type: "object",
        properties: {
          documentType: { type: "string", enum: [...DOCUMENT_TYPES] },
          nameContains: {
            type: "string",
            description: `Keep only documents whose title contains this text (case-insensitive). Scans the first ${LIMITS.documents.max} documents of the type; the result says how many were scanned.`,
          },
          limit: {
            type: "integer",
            description: `Documents to return (default ${LIMITS.documents.default}, max ${LIMITS.documents.max}).`,
          },
        },
        required: ["documentType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description:
        "Every project in the vault. Projects are envelopes inside scope-of-work documents (powerhouse/scopeofwork): each row is one envelope — its documentId and title are the SCOPE's (the documentId is what you cite), and `envelope` holds the project's own id, code, title, set status, owner and `cite`, the anchored marker [[scopeId#envelopeId]] that cites this one project — with deliverable progress (delivered/total and %), budget (type, currency, stored budget, fixed target if any, Σ quoted lines), cited-knowledge count and its work breakdown as a citable {documentId, title}. Start here for any question about projects, deliverables, goals or who is working on what; then read_document the documentId for the full outline. Cite as [[documentId]] — the UUID, never a name.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Read any document by documentId. For a powerhouse/scopeofwork this returns the whole scope as one outline (text) plus structured data: status, every envelope (code, title, owner, set status and progress, budget type/currency, fixed or quote-derived budget, spend, references, cited knowledge with titles, linked WBS and its goal progress), every deliverable with status, owner, progress, quote (quantity × unit cost, margin), milestone and the WBS goal that delivers it, the deliverables no envelope funds, roadmaps and milestones (date, status, coordinators, budget, deliverables), and contributors. For a bai/wbs it returns the goal tree with block reasons, outcomes and notes. For everything else (notably bai/source) it returns metadata plus an 8,000-character window of the main text starting at offset; when hasMore is true, call again with nextOffset. A source's metadata includes extractedClaims — ids of notes derived from it — which you can read_note. The reverse is not available: a note does not record its source. Every result carries the documentId you cite it by.",
      parameters: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          offset: {
            type: "integer",
            description: "Character offset into the main text (default 0).",
          },
        },
        required: ["documentId"],
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Transport                                                         */
/* ------------------------------------------------------------------ */

type GqlOutcome<T> = { data: T } | { error: string };

async function gql<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GqlOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    return {
      error: `network: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) return { error: `Switchboard responded HTTP ${res.status}` };
  const json = (await res.json()) as {
    data?: T;
    errors?: { message?: string }[];
  };
  if (json.errors?.length) {
    return { error: json.errors.map((e) => e.message ?? "unknown").join("; ") };
  }
  if (json.data === undefined) return { error: "empty response" };
  return { data: json.data };
}

const graphEndpoint = () => resolveKnowledgeGraphEndpoint();
const reactorEndpoint = () => resolveReactorEndpoint();

/** Titles for up to `limit` note ids in ONE aliased request; unknown ids are absent. */
async function noteTitles(
  driveId: string,
  ids: string[],
  limit: number,
): Promise<Map<string, string>> {
  const wanted = ids.slice(0, limit);
  const titles = new Map<string, string>();
  if (wanted.length === 0) return titles;
  const aliases = wanted
    .map(
      (_, i) =>
        `n${i}: knowledgeGraphNodeByDocumentId(driveId: $driveId, documentId: $d${i}) { title }`,
    )
    .join("\n");
  const vars = wanted.map((_, i) => `$d${i}: String!`).join(", ");
  const variables: Record<string, unknown> = { driveId };
  wanted.forEach((id, i) => {
    variables[`d${i}`] = id;
  });
  const r = await gql<Record<string, { title: string | null } | null>>(
    graphEndpoint(),
    `query NT($driveId: ID!, ${vars}) { ${aliases} }`,
    variables,
  );
  if ("error" in r) return titles;
  wanted.forEach((id, i) => {
    const t = r.data[`n${i}`]?.title;
    if (t) titles.set(id, t);
  });
  return titles;
}

/**
 * The refusal for a document the vault no longer holds, or null when it does
 * (or when membership could not be checked, which must never hide the vault).
 */
async function notInVault(driveId: string, documentId: string): Promise<string | null> {
  const live = await liveDocumentIds(driveId);
  if (!live || live.has(documentId)) return null;
  return `${documentId} is not in this vault — it was deleted, or it belongs to another drive. Do not report its contents; use recent_changes or search_vault to find what the vault holds now.`;
}

/** Read a document, or return the failure the tool should report. */
async function readDoc(
  documentId: string,
): Promise<
  | { doc: NonNullable<Awaited<ReturnType<typeof fetchDocumentState>>> }
  | { error: string }
> {
  try {
    const doc = await fetchDocumentState(documentId);
    return doc ? { doc } : { error: `no document with id ${documentId}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A document's global scope, with its collections guaranteed.
 *
 * The reducers keep these arrays present, but a document written by an older
 * version of a model — or a partial read — can arrive without them, and a
 * renderer that maps over `projects` would then take the whole tool down
 * rather than show what it did get.
 */
function arrayOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
const wbsState = (state: Record<string, unknown>): WorkBreakdownStructureState => {
  const g = (state.global ?? {}) as WorkBreakdownStructureState;
  return { ...g, goals: arrayOf(g.goals), references: arrayOf(g.references) };
};
const scopeState = (state: Record<string, unknown>): ScopeOfWorkState => {
  const g = (state.global ?? {}) as ScopeOfWorkState;
  return {
    ...g,
    projects: arrayOf(g.projects),
    deliverables: arrayOf(g.deliverables),
    roadmaps: arrayOf(g.roadmaps),
    contributors: arrayOf(g.contributors),
  };
};
/** Envelopes stored before knowledgeRefs existed have no array at all. */
const envelopeRefs = (env: { knowledgeRefs: string[] }): string[] =>
  (env as { knowledgeRefs?: string[] }).knowledgeRefs ?? [];

/**
 * Names other harnesses use for the same jobs. A model prompted elsewhere —
 * or a proxy that injects its own web tools alongside ours — reaches for
 * `web_search` or `web_fetch`; answering those rather than replying "unknown
 * tool" costs one lookup and saves a round trip.
 */
const TOOL_ALIASES: Record<string, string> = {
  web_search: "search_web",
  search: "search_web",
  browse: "read_url",
  web_fetch: "read_url",
  fetch_url: "read_url",
  open_url: "read_url",
};

/** Everything the vault's own chat may call: the vault, plus the web. */
export const CHAT_TOOLS: ToolSchema[] = [...VAULT_TOOLS, ...WEB_TOOLS];

/* ------------------------------------------------------------------ */
/*  Every document in the vault, by last edit                          */
/* ------------------------------------------------------------------ */

export interface VaultDocumentRow {
  documentId: string;
  title: string;
  documentType: string;
  /** ISO instant of the last operation on the document. */
  lastModifiedAt: string;
  /** From the graph index when the kind is indexed; null for sources etc. */
  noteType: string | null;
  status: string | null;
}

interface VaultDocumentListing {
  /** Newest edit first; only documents with a known edit time. */
  documents: VaultDocumentRow[];
  /** Documents in the vault with no recorded edit time — older than change tracking. */
  undated: number;
  /**
   * Every document the drive tree holds — the vault's membership, whether or
   * not an edit time is known for it. The reactor keeps a deleted document's
   * record, so this is what separates "in the vault" from "the reactor still
   * remembers it".
   */
  memberIds: Set<string>;
  fetchedAt: number;
}

/** Long enough to make the follow-up calls of one answer free; short enough to see this hour's edits. */
const LISTING_TTL_MS = 60_000;
const listingCache = new Map<string, VaultDocumentListing>();

/** A file in the drive tree: the vault's own record of what it holds. */
interface DriveMember {
  name: string | null;
  documentType: string;
}
const membersCache = new Map<string, { at: number; members: Map<string, DriveMember> }>();

/**
 * What the drive holds, from the drive document's own node list.
 *
 * This is the vault's membership and nothing else — one small query, shared
 * by everything that needs to know whether a document is still here. The
 * reactor keeps a deleted document's record and will happily answer for it,
 * so any tool that asks the reactor by type or by id checks here first.
 *
 * `null` means the tree could not be read. Callers then let everything
 * through: a failed request must not make the vault look empty.
 */
async function driveMembers(
  driveId: string,
): Promise<Map<string, DriveMember> | null> {
  const cached = membersCache.get(driveId);
  if (cached && Date.now() - cached.at < LISTING_TTL_MS) return cached.members;
  const tree = await gql<{
    document: { document: { state: unknown } | null } | null;
  }>(
    reactorEndpoint(),
    `query DriveTree($id: String!) { document(identifier: $id) { document { state } } }`,
    { id: driveId },
  );
  if ("error" in tree) return null;
  const rawState = tree.data.document?.document?.state;
  const state = typeof rawState === "string" ? (JSON.parse(rawState) as unknown) : rawState;
  const nodes = (state as { global?: { nodes?: unknown[] } } | null)?.global?.nodes;
  // No node list is not an empty vault — it is a drive we failed to read.
  // Reporting it as empty would hide every document behind one bad response.
  if (!Array.isArray(nodes)) return null;
  const members = new Map<string, DriveMember>();
  for (const raw of nodes as {
    id?: unknown;
    kind?: unknown;
    name?: unknown;
    documentType?: unknown;
  }[]) {
    const n = raw;
    if (n.kind !== "file" || typeof n.id !== "string" || typeof n.documentType !== "string") continue;
    members.set(n.id, {
      name: typeof n.name === "string" && n.name ? n.name : null,
      documentType: n.documentType,
    });
  }
  membersCache.set(driveId, { at: Date.now(), members });
  return members;
}

/**
 * Which documents are in the vault, and when each was last edited.
 *
 * Two facts make this two queries rather than one. `findDocuments(parentId)`
 * returns every document the reactor holds for the drive WITH
 * `lastModifiedAtUtcIso` — measured on the live vault: 1,504 rows, all
 * stamped, in ~2s — so it is the authority on time. But it also returns
 * documents that have left the drive tree (40 on that vault: notes deleted
 * from the tree whose records the reactor still holds), so the drive
 * document's own node list stays the authority on membership, and it is
 * where a document's name comes from.
 *
 * The graph index is asked for titles, not times: a note's tree name is its
 * slug (`recovery-flow-from-wallet`), and the index has the human title. It
 * covers indexed kinds only, which is why it can never be the time source —
 * a source or the health report would be missing. Compared across the live
 * vault's 1,057 indexed documents, its `updatedAt` was never ahead of the
 * reactor's stamp (equal on 945, behind on 112 — reindex lag), so the
 * reactor wins wherever both know a document and the index stands in only
 * where it does not.
 *
 * One cached result per drive; `recent_changes` filters and slices it.
 */
async function vaultDocumentListing(
  driveId: string,
): Promise<VaultDocumentListing | { error: string }> {
  const cached = listingCache.get(driveId);
  if (cached && Date.now() - cached.fetchedAt < LISTING_TTL_MS) return cached;

  const [members, contained, indexed] = await Promise.all([
    driveMembers(driveId),
    gql<{ findDocuments: { items: { id: string; lastModifiedAtUtcIso: string | null }[] } }>(
      reactorEndpoint(),
      `query Contained($parentId: String!) {
        findDocuments(search: { parentId: $parentId }, paging: { limit: 5000 }) {
          items { id lastModifiedAtUtcIso }
        }
      }`,
      { parentId: driveId },
    ),
    gql<{ knowledgeGraphRecent: { documentId: string; title: string | null; noteType: string | null; status: string | null; updatedAt: string }[] }>(
      graphEndpoint(),
      `query Indexed($driveId: ID!) {
        knowledgeGraphRecent(driveId: $driveId, limit: 5000) { documentId title noteType status updatedAt }
      }`,
      { driveId },
    ),
  ]);
  if (!members) return { error: "could not read the drive's document list" };

  const stamps = new Map<string, string>();
  if (!("error" in contained)) {
    for (const d of contained.data.findDocuments.items) {
      if (d.lastModifiedAtUtcIso) stamps.set(d.id, d.lastModifiedAtUtcIso);
    }
  }
  const index = new Map<string, { title: string | null; noteType: string | null; status: string | null }>();
  if (!("error" in indexed)) {
    for (const n of indexed.data.knowledgeGraphRecent) {
      // Titles and badges from the index; its `updatedAt` only stands in
      // when the reactor listing failed or did not carry the document.
      if (!stamps.has(n.documentId)) stamps.set(n.documentId, n.updatedAt);
      index.set(n.documentId, { title: n.title, noteType: n.noteType, status: n.status });
    }
  }

  const documents: VaultDocumentRow[] = [];
  let undated = 0;
  for (const [id, member] of members) {
    const lastModifiedAt = stamps.get(id);
    if (!lastModifiedAt) {
      undated++;
      continue;
    }
    const meta = index.get(id);
    documents.push({
      documentId: id,
      title: meta?.title || member.name || id,
      documentType: member.documentType,
      lastModifiedAt,
      noteType: meta?.noteType ?? null,
      status: meta?.status ?? null,
    });
  }
  documents.sort((a, b) => (a.lastModifiedAt < b.lastModifiedAt ? 1 : a.lastModifiedAt > b.lastModifiedAt ? -1 : 0));
  const listing = { documents, undated, memberIds: new Set(members.keys()), fetchedAt: Date.now() };
  listingCache.set(driveId, listing);
  return listing;
}

/**
 * The ids the vault actually holds, or `null` when membership could not be
 * established. A document deleted from the drive keeps its record in the
 * reactor, so a query that asks the reactor by type — rather than the graph
 * index, which processes deletions — will hand back documents nobody can
 * open any more. `null` means the tree could not be read: the caller lets
 * everything through rather than hiding the vault behind a failed request.
 */
async function liveDocumentIds(driveId: string): Promise<Set<string> | null> {
  const members = await driveMembers(driveId);
  return members ? new Set(members.keys()) : null;
}

/** A document's most recent operation: who made it, and what it was. */
interface LastOperation {
  action: string;
  change: string;
  address: string | null;
  app: string | null;
}

/**
 * The last operation of one document, in a single request.
 *
 * `paging.offset` is ignored by the reactor and a page's `totalCount` counts
 * only that page, so neither can find the end of a history. But the document
 * listing already knows when it was last modified, and `timestampFrom` takes
 * that instant: what comes back is the handful of operations at that moment,
 * of which the highest index is the one being asked about.
 */
async function lastOperationOf(
  documentId: string,
  lastModifiedAt: string,
): Promise<LastOperation | null> {
  const r = await gql<{
    // Optional on purpose: a partial GraphQL response carries `data` without
    // the field, and this must degrade rather than throw.
    documentOperations?: {
      items: {
        index: number;
        action: {
          type: string;
          input: Record<string, unknown> | null;
          context: {
            signer: {
              user: { address: string | null } | null;
              app: { name: string | null } | null;
            } | null;
          } | null;
        };
      }[];
    };
  }>(
    reactorEndpoint(),
    `query LastOp($id: String!, $from: String) {
      documentOperations(
        filter: { documentId: $id, scopes: ["global"], timestampFrom: $from }
        paging: { limit: 10 }
      ) {
        items {
          index
          action { type input context { signer { user { address } app { name } } } }
        }
      }
    }`,
    { id: documentId, from: lastModifiedAt },
  );
  if ("error" in r) return null;
  // A response shaped unexpectedly (a partial error, a schema that moved on)
  // costs this row its detail, never the whole answer.
  const items = r.data.documentOperations?.items ?? [];
  const last = items.reduce<(typeof items)[number] | null>(
    (newest, op) => (!newest || op.index > newest.index ? op : newest),
    null,
  );
  if (!last) return null;
  const signer = last.action.context?.signer;
  return {
    action: last.action.type,
    change: summarizeOperation(last.action.type, last.action.input ?? {}),
    // An unsigned operation carries an empty address, not a missing one.
    address: signer?.user?.address || null,
    app: signer?.app?.name || null,
  };
}

/** Test seam: forget the cached listing and drive membership. */
export function resetVaultDocumentListing(): void {
  listingCache.clear();
  membersCache.clear();
}

/* ------------------------------------------------------------------ */
/*  Argument helpers                                                  */
/* ------------------------------------------------------------------ */

function bool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  return v === true || v === "true";
}

/**
 * A string argument, or null. A value wrapped as `[[id]]` (or quoted) is a
 * model copying the citation syntax it was taught into a tool argument —
 * the id inside is what it meant, so that is what the tool gets.
 */
function str(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (typeof v !== "string") return null;
  const unwrapped = v
    .trim()
    .replace(/^\[\[\s*([\s\S]*?)\s*\]\]$/, "$1")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return unwrapped ? unwrapped : null;
}

function int(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  max: number,
): number {
  const v = args[key];
  const n =
    typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(1, Math.min(n, max));
}

/** A non-negative integer argument; `int()` is for 1-based limits. */
function nonNegativeInt(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0;
}

const fail = (error: string): ToolResult => ({ ok: false, error });
const ok = (data: unknown, summary: string): ToolResult => ({
  ok: true,
  data,
  summary,
});

/* ------------------------------------------------------------------ */
/*  Executor                                                          */
/* ------------------------------------------------------------------ */

export async function executeTool(
  rawName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { driveId } = ctx;
  const name = TOOL_ALIASES[rawName] ?? rawName;

  switch (name) {
    case "search_vault": {
      const query = str(args, "query");
      if (!query) return fail("search_vault needs a non-empty query");
      const limit = int(
        args,
        "limit",
        LIMITS.search.default,
        LIMITS.search.max,
      );
      const includeArchived = bool(args, "includeArchived");
      const r = await gql<{
        knowledgeGraphSemanticSearch: {
          similarity: number;
          matchedBy: string[];
          node: Record<string, unknown>;
        }[];
      }>(
        graphEndpoint(),
        `query S($driveId: ID!, $query: String!, $limit: Int, $includeArchived: Boolean) {
          knowledgeGraphSemanticSearch(driveId: $driveId, query: $query, mode: HYBRID, limit: $limit, includeArchived: $includeArchived) {
            similarity matchedBy node { ${NOTE_FIELDS} }
          }
        }`,
        { driveId, query, limit, includeArchived },
      );
      if ("error" in r) return fail(r.error);
      const hits = r.data.knowledgeGraphSemanticSearch.map((h) => ({
        ...h.node,
        similarity: Number(h.similarity.toFixed(3)),
        matchedBy: h.matchedBy,
      }));
      return ok(
        hits,
        `searched "${query}" → ${hits.length} note${hits.length === 1 ? "" : "s"}`,
      );
    }

    case "read_note": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("read_note needs a documentId");
      const r = await gql<{
        knowledgeGraphNodeByDocumentId: Record<string, unknown> | null;
      }>(
        graphEndpoint(),
        `query N($driveId: ID!, $documentId: String!) {
          knowledgeGraphNodeByDocumentId(driveId: $driveId, documentId: $documentId) {
            ${NOTE_FIELDS} content author sourceOrigin createdAt updatedAt topics
          }
        }`,
        { driveId, documentId },
      );
      if ("error" in r) return fail(r.error);
      const node = r.data.knowledgeGraphNodeByDocumentId;
      if (!node)
        return fail(`no note with id ${documentId} in the graph index`);
      const content = typeof node.content === "string" ? node.content : "";
      const truncated = content.length > LIMITS.noteContent;
      return ok(
        {
          ...node,
          content: truncated ? content.slice(0, LIMITS.noteContent) : content,
          truncated,
        },
        `read "${typeof node.title === "string" ? node.title : documentId}"`,
      );
    }

    case "vault_editors": {
      const limit = int(args, "limit", LIMITS.editors.default, LIMITS.editors.max);
      const sinceRaw = str(args, "since");
      let since: string | null = null;
      if (sinceRaw) {
        const t = Date.parse(sinceRaw);
        if (Number.isNaN(t)) return fail(`since must be an ISO 8601 date, e.g. 2026-09-01 — got "${sinceRaw}"`);
        since = new Date(t).toISOString();
      }
      const r = await gql<{
        knowledgeGraphActivity: {
          documentId: string;
          timestamp: string;
          signerAddress: string | null;
          signerApp: string | null;
        }[];
      }>(
        graphEndpoint(),
        `query Editors($driveId: ID!, $limit: Int, $since: String) {
          knowledgeGraphActivity(driveId: $driveId, limit: $limit, since: $since) {
            documentId timestamp signerAddress signerApp
          }
        }`,
        { driveId, limit: LIMITS.activity, since },
      );
      if ("error" in r) return fail(r.error);
      const operations = r.data.knowledgeGraphActivity;

      interface Tally {
        address: string;
        operations: number;
        apps: Record<string, number>;
        documents: Set<string>;
        firstEdit: string;
        lastEdit: string;
      }
      const byAddress = new Map<string, Tally>();
      let unsigned = 0;
      let from: string | null = null;
      let to: string | null = null;
      for (const op of operations) {
        if (!from || op.timestamp < from) from = op.timestamp;
        if (!to || op.timestamp > to) to = op.timestamp;
        // An unsigned operation carries an empty address, not a missing one.
        const address = op.signerAddress || null;
        if (!address) {
          unsigned++;
          continue;
        }
        const tally = byAddress.get(address) ?? {
          address,
          operations: 0,
          apps: {},
          documents: new Set<string>(),
          firstEdit: op.timestamp,
          lastEdit: op.timestamp,
        };
        tally.operations++;
        const app = op.signerApp || "unknown";
        tally.apps[app] = (tally.apps[app] ?? 0) + 1;
        tally.documents.add(op.documentId);
        if (op.timestamp < tally.firstEdit) tally.firstEdit = op.timestamp;
        if (op.timestamp > tally.lastEdit) tally.lastEdit = op.timestamp;
        byAddress.set(address, tally);
      }
      const ranked = [...byAddress.values()]
        .sort((a, b) => b.operations - a.operations)
        .slice(0, limit);
      // One person, one row: the same address editing through two apps is
      // not two editors, which is exactly the mistake a hand count makes.
      const names = await resolveEnsNames(ranked.map((e) => e.address));
      const editors = ranked.map((e) => ({
        name: names.get(e.address) ?? null,
        address: e.address,
        short: shortAddress(e.address),
        operations: e.operations,
        documents: e.documents.size,
        apps: e.apps,
        firstEdit: e.firstEdit,
        lastEdit: e.lastEdit,
      }));
      // `.at` rather than `[0]`: a vault whose operations are all unsigned
      // has no top editor, and the type should admit it.
      const top = editors.at(0);
      return ok(
        {
          editors,
          countedOperations: operations.length,
          signedOperations: operations.length - unsigned,
          unsignedOperations: unsigned,
          from,
          to,
          coverage:
            "Operations recorded in the graph index — indexed document types only, and only those the indexer has consumed. Sources and other unindexed types are not counted.",
        },
        `${byAddress.size} editor${byAddress.size === 1 ? "" : "s"} across ${operations.length} recorded operation${operations.length === 1 ? "" : "s"}` +
          (unsigned ? ` (${unsigned} unsigned)` : "") +
          (top ? `; most active: ${top.name ?? top.short} with ${top.operations}` : ""),
      );
    }

    case "recent_changes": {
      const limit = int(args, "limit", LIMITS.recent.default, LIMITS.recent.max);
      const sinceRaw = str(args, "since");
      let since: string | null = null;
      if (sinceRaw) {
        const t = Date.parse(sinceRaw);
        if (Number.isNaN(t)) return fail(`since must be an ISO 8601 date, e.g. 2026-09-01 — got "${sinceRaw}"`);
        since = new Date(t).toISOString();
      }
      const type = str(args, "documentType");
      if (type && !(DOCUMENT_TYPES as readonly string[]).includes(type)) {
        return fail(`documentType must be one of: ${DOCUMENT_TYPES.join(", ")}`);
      }
      const listing = await vaultDocumentListing(driveId);
      if ("error" in listing) return fail(listing.error);
      const { documents, undated } = listing;
      const rows = documents
        .filter((d) => (type ? d.documentType === type : true))
        .filter((d) => (since ? d.lastModifiedAt >= since : true))
        .slice(0, limit);

      // Who and what, for the rows the reader will actually look at. One
      // request per document, all in flight together: the alternative is the
      // model calling document_history once per row, which is the same
      // requests done slowly and usually not done at all.
      const detailed = rows.slice(0, LIMITS.recentDetail);
      const lastOps = await Promise.all(
        detailed.map((d) => lastOperationOf(d.documentId, d.lastModifiedAt)),
      );
      const names = await resolveEnsNames(
        lastOps.map((op) => op?.address ?? "").filter((a) => a !== ""),
      );
      const items = rows.map((row, i) => {
        const op = i < lastOps.length ? lastOps[i] : null;
        if (!op) return row;
        return {
          ...row,
          change: op.change,
          action: op.action,
          by: op.address,
          byName: op.address ? (names.get(op.address) ?? null) : null,
          byShort: op.address ? shortAddress(op.address) : null,
          via: op.app,
        };
      });

      const scope = type ? `${type} document` : "document";
      return ok(
        { items, undated },
        `listed the ${rows.length} most recently edited ${scope}${rows.length === 1 ? "" : "s"} of ${documents.length}${since ? ` since ${since.slice(0, 10)}` : ""}` +
          (undated ? ` (${undated} more ${undated === 1 ? "has" : "have"} no recorded edit time)` : "") +
          (items[0] && "change" in items[0]
            ? `; newest: ${(items[0] as { byName?: string | null; byShort?: string | null }).byName ?? (items[0] as { byShort?: string | null }).byShort ?? "someone"} — ${(items[0] as { change?: string }).change ?? ""}`
            : ""),
      );
    }

    case "list_topics": {
      const limit = int(
        args,
        "limit",
        LIMITS.topics.default,
        LIMITS.topics.max,
      );
      const r = await gql<{
        knowledgeGraphTopics: { name: string; noteCount: number }[];
      }>(
        graphEndpoint(),
        `query T($driveId: ID!) { knowledgeGraphTopics(driveId: $driveId) { name noteCount } }`,
        { driveId },
      );
      if ("error" in r) return fail(r.error);
      const all = r.data.knowledgeGraphTopics;
      const top = [...all]
        .sort((a, b) => b.noteCount - a.noteCount)
        .slice(0, limit);
      return ok(top, `listed ${top.length} of ${all.length} topics`);
    }

    case "notes_by_topic": {
      const topic = str(args, "topic");
      if (!topic) return fail("notes_by_topic needs a topic");
      const limit = int(
        args,
        "limit",
        LIMITS.byTopic.default,
        LIMITS.byTopic.max,
      );
      const r = await gql<{ knowledgeGraphByTopic: Record<string, unknown>[] }>(
        graphEndpoint(),
        `query B($driveId: ID!, $topic: String!, $includeArchived: Boolean) {
          knowledgeGraphByTopic(driveId: $driveId, topic: $topic, includeArchived: $includeArchived) { ${NOTE_FIELDS} }
        }`,
        { driveId, topic, includeArchived: bool(args, "includeArchived") },
      );
      if ("error" in r) return fail(r.error);
      const all = r.data.knowledgeGraphByTopic;
      return ok(
        all.slice(0, limit),
        `topic #${topic} → ${all.length} note${all.length === 1 ? "" : "s"}`,
      );
    }

    case "related_notes": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("related_notes needs a documentId");
      const limit = int(
        args,
        "limit",
        LIMITS.related.default,
        LIMITS.related.max,
      );
      const r = await gql<{
        knowledgeGraphSimilar: {
          similarity: number;
          node: Record<string, unknown>;
        }[];
      }>(
        graphEndpoint(),
        `query R($driveId: ID!, $documentId: String!, $limit: Int, $includeArchived: Boolean) {
          knowledgeGraphSimilar(driveId: $driveId, documentId: $documentId, limit: $limit, includeArchived: $includeArchived) {
            similarity node { ${NOTE_FIELDS} }
          }
        }`,
        { driveId, documentId, limit, includeArchived: bool(args, "includeArchived") },
      );
      if ("error" in r) return fail(r.error);
      const hits = r.data.knowledgeGraphSimilar.map((h) => ({
        ...h.node,
        similarity: Number(h.similarity.toFixed(3)),
      }));
      return ok(
        hits,
        `${hits.length} note${hits.length === 1 ? "" : "s"} similar to ${documentId.slice(0, 8)}`,
      );
    }

    case "linked_notes": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("linked_notes needs a documentId");
      const r = await gql<{
        out: {
          targetDocumentId: string;
          linkType: string | null;
          targetTitle: string | null;
          reason: string | null;
          confidence: string | null;
        }[];
        inc: {
          sourceDocumentId: string;
          linkType: string | null;
          reason: string | null;
          confidence: string | null;
        }[];
      }>(
        graphEndpoint(),
        `query L($driveId: ID!, $documentId: String!) {
          out: knowledgeGraphForwardLinks(driveId: $driveId, documentId: $documentId) { targetDocumentId linkType targetTitle reason confidence }
          inc: knowledgeGraphBacklinks(driveId: $driveId, documentId: $documentId) { sourceDocumentId linkType reason confidence }
        }`,
        { driveId, documentId },
      );
      if ("error" in r) return fail(r.error);
      // `reason` is the edge's articulation — why the link exists — read
      // from relationship metadata. Null means nobody has said yet.
      const outgoing = r.data.out.slice(0, LIMITS.links).map((e) => ({
        documentId: e.targetDocumentId,
        title: e.targetTitle,
        linkType: e.linkType,
        reason: e.reason,
        confidence: e.confidence,
      }));
      const incomingEdges = r.data.inc.slice(0, LIMITS.links);

      // Backlink edges carry no source title. Resolve them in ONE aliased
      // request rather than one request per edge.
      let titles: Record<string, { title: string | null } | null> = {};
      if (incomingEdges.length > 0) {
        const aliases = incomingEdges
          .map(
            (_, i) =>
              `n${i}: knowledgeGraphNodeByDocumentId(driveId: $driveId, documentId: $d${i}) { title }`,
          )
          .join("\n");
        const vars = incomingEdges.map((_, i) => `$d${i}: String!`).join(", ");
        const variables: Record<string, unknown> = { driveId };
        incomingEdges.forEach((e, i) => {
          variables[`d${i}`] = e.sourceDocumentId;
        });
        const t = await gql<Record<string, { title: string | null } | null>>(
          graphEndpoint(),
          `query LT($driveId: ID!, ${vars}) { ${aliases} }`,
          variables,
        );
        if (!("error" in t)) titles = t.data;
      }
      const incoming = incomingEdges.map((e, i) => ({
        documentId: e.sourceDocumentId,
        title: titles[`n${i}`]?.title ?? null,
        linkType: e.linkType,
        reason: e.reason,
        confidence: e.confidence,
      }));
      return ok(
        { outgoing, incoming },
        `links of ${documentId.slice(0, 8)}: ${outgoing.length} out, ${incoming.length} in`,
      );
    }

    case "vault_stats": {
      const r = await gql<{
        knowledgeGraphStats: {
          nodeCount: number;
          noteCount: number;
          mocCount: number;
          claimCount: number;
          tensionCount: number;
          openTensionCount: number;
          observationCount: number;
          scopeCount: number;
          wbsCount: number;
          edgeCount: number;
          orphanCount: number;
        };
        knowledgeGraphDensity: number;
      }>(
        graphEndpoint(),
        `query V($driveId: ID!) {
          knowledgeGraphStats(driveId: $driveId) {
            nodeCount noteCount mocCount claimCount tensionCount openTensionCount observationCount
            scopeCount wbsCount edgeCount orphanCount
          }
          knowledgeGraphDensity(driveId: $driveId)
        }`,
        { driveId },
      );
      if ("error" in r) return fail(r.error);
      const s = r.data.knowledgeGraphStats;
      return ok(
        { ...s, density: r.data.knowledgeGraphDensity },
        `vault: ${s.noteCount} notes, ${s.mocCount} maps, ${s.scopeCount} scope${s.scopeCount === 1 ? "" : "s"} of work, ${s.edgeCount} links, ${s.orphanCount} orphans, ${s.openTensionCount} open tension${s.openTensionCount === 1 ? "" : "s"}`,
      );
    }

    case "list_documents": {
      const type = str(args, "documentType");
      if (!type || !(DOCUMENT_TYPES as readonly string[]).includes(type)) {
        return fail(
          `documentType must be one of: ${DOCUMENT_TYPES.join(", ")}`,
        );
      }
      const limit = int(
        args,
        "limit",
        LIMITS.documents.default,
        LIMITS.documents.max,
      );
      // The reactor's findDocuments has no title filter, so a name match is
      // applied here over the largest page it will serve. Honest about the
      // window: `scanned` says how many titles were actually looked at.
      const nameContains = str(args, "nameContains")?.toLowerCase() ?? null;
      const r = await gql<{
        findDocuments: {
          totalCount: number;
          items: {
            id: string;
            name: string | null;
            documentType: string | null;
          }[];
        };
      }>(
        reactorEndpoint(),
        `query D($type: String!, $limit: Int) {
          findDocuments(search: { type: $type }, paging: { limit: $limit }) {
            totalCount items { id name documentType }
          }
        }`,
        { type, limit: nameContains ? LIMITS.documents.max : limit },
      );
      if ("error" in r) return fail(r.error);
      const { totalCount, items } = r.data.findDocuments;
      // The reactor answers for every drive it holds, and keeps deleted
      // documents; the vault is what its drive tree lists.
      const live = await liveDocumentIds(driveId);
      const inVault = live ? items.filter((d) => live.has(d.id)) : items;
      const matching = nameContains
        ? inVault.filter((d) => (d.name ?? "").toLowerCase().includes(nameContains))
        : inVault;
      // Same citation contract as every other tool: documentId + title (+
      // documentType), so [[documentId]] works for a source or a tension
      // exactly as it does for a note.
      const listed = matching.slice(0, limit).map((d) => ({
        documentId: d.id,
        title: d.name ?? d.id,
        documentType: d.documentType ?? type,
      }));
      // With membership known, the honest total is what the vault holds;
      // without it, the reactor's own count is all anyone can say.
      const total = live ? inVault.length : totalCount;
      const where = live ? " in the vault" : "";
      if (nameContains) {
        return ok(
          { total, scanned: inVault.length, matched: matching.length, items: listed },
          `listed ${listed.length} of ${matching.length} ${type} whose title contains "${nameContains}" (scanned ${inVault.length}${where} of ${totalCount} the reactor holds)`,
        );
      }
      return ok(
        { total, items: listed },
        `listed ${listed.length} of ${total} ${type}${where}`,
      );
    }

    case "list_projects": {
      // Envelopes: every scope-of-work document contributes its projects[].
      const sc = await gql<{
        findDocuments: { totalCount: number; items: { id: string; name: string | null }[] };
      }>(
        reactorEndpoint(),
        `query S($limit: Int) {
          findDocuments(search: { type: "powerhouse/scopeofwork" }, paging: { limit: $limit }) {
            totalCount items { id name }
          }
        }`,
        { limit: LIMITS.projects },
      );
      const envelopeRows: Record<string, unknown>[] = [];
      let scopeCount = 0;
      if (!("error" in sc)) {
        // Scopes deleted from the drive still answer here — read them and
        // their envelopes would be reported as work in progress.
        const live = await liveDocumentIds(driveId);
        const scopes = live
          ? sc.data.findDocuments.items.filter((d) => live.has(d.id))
          : sc.data.findDocuments.items;
        scopeCount = scopes.length;
        for (const item of scopes) {
          const read = await readDoc(item.id);
          if ("error" in read) continue;
          const g = scopeState(read.doc.state);
          const agentName = new Map(g.contributors.map((c) => [c.id, c.name] as const));
          for (const env of g.projects) {
            const ids = new Set(env.scope?.deliverables ?? []);
            const ds = g.deliverables.filter((d) => ids.has(d.id));
            // `documentId` + `title` name the SCOPE: that pair is what the
            // citation harvester registers, and a chip for [[scopeId]] must
            // read as the scope, not as whichever envelope was listed first.
            envelopeRows.push({
              documentId: item.id,
              documentType: "powerhouse/scopeofwork",
              title: g.title || item.name || item.id,
              envelope: {
                id: env.id,
                code: env.code,
                title: env.title,
                status: env.scope?.status ?? "DRAFT",
                owner: env.projectOwner ? (agentName.get(env.projectOwner) ?? env.projectOwner) : null,
                // Ready-made anchored marker: cite this envelope, not just its scope.
                cite: `[[${item.id}#${env.id}]]`,
              },
              progress: rollupDeliverables(ds),
              budget: {
                type: env.budgetType ?? null,
                currency: env.currency ?? null,
                budget: env.budget ?? null,
                targetBudget: env.targetBudget ?? null,
              },
              knowledgeRefs: envelopeRefs(env).length,
              wbs: env.wbsRef
                ? { documentId: env.wbsRef, documentType: "bai/wbs", title: `Work breakdown for ${env.title}` }
                : null,
            });
          }
        }
      }
      return ok(
        { total: envelopeRows.length, projects: envelopeRows, scopes: scopeCount },
        `listed ${envelopeRows.length} envelope${envelopeRows.length === 1 ? "" : "s"} across ${scopeCount} scope${scopeCount === 1 ? "" : "s"}`,
      );
    }

    case "search_web": {
      const query = str(args, "query");
      if (!query) return fail("search_web needs a query");
      const limit = int(args, "limit", LIMITS.web.default, LIMITS.web.max);
      try {
        const found = await searchWeb(query, { limit, settings: readWebSettings() });
        const source = found.via === "tavily" ? "Tavily" : "DuckDuckGo";
        return ok(
          { ...found, outsideTheVault: true },
          `searched the web for "${query}" via ${source} → ${found.results.length} result${found.results.length === 1 ? "" : "s"}`,
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }

    case "ens_lookup": {
      const query = str(args, "query");
      if (!query) return fail("ens_lookup needs an address or an ENS name");
      try {
        const id = await resolveEns(query);
        return ok(
          { ...id, outsideTheVault: true },
          id.name
            ? `${id.name} is the ENS name of ${id.address ?? query}`
            : `${query} has no ENS name${id.reason ? ` — ${id.reason.split(".")[0]}` : ""}`,
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }

    case "read_url": {
      const url = str(args, "url");
      if (!url) return fail("read_url needs a url");
      try {
        const page = await readUrl(url, { maxChars: PAGE_MAX_CHARS });
        return ok(
          { ...page, outsideTheVault: true },
          page.warning
            ? `read ${page.url} — nothing usable: ${page.warning.split(":")[0]}`
            : `read ${page.title ? `"${page.title}"` : page.url}${page.truncated ? " (truncated)" : ""}`,
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }

    case "document_history": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("document_history needs a documentId");
      const gone = await notInVault(driveId, documentId);
      if (gone) return fail(gone);
      const limit = int(args, "limit", LIMITS.history.default, LIMITS.history.max);

      // The document first: its identity, and how many operations it has.
      // `revisionsList` is the real count per scope — `totalCount` on an
      // operations page only counts that page.
      const head = await gql<{
        document: {
          document: {
            id: string;
            name: string | null;
            documentType: string | null;
            createdAtUtcIso: string | null;
            lastModifiedAtUtcIso: string | null;
            revisionsList: { scope: string; revision: number }[];
          } | null;
        } | null;
      }>(
        reactorEndpoint(),
        `query History($id: String!) {
          document(identifier: $id) {
            document {
              id name documentType createdAtUtcIso lastModifiedAtUtcIso
              revisionsList { scope revision }
            }
          }
        }`,
        { id: documentId },
      );
      if ("error" in head) return fail(head.error);
      const doc = head.data.document?.document;
      if (!doc) return fail(`no document with id ${documentId}`);
      const revision =
        doc.revisionsList.find((r) => r.scope === "global")?.revision ?? 0;

      // The reactor ignores `paging.offset`, so the tail is selected by
      // revision: everything from (revision - limit) onwards.
      const ops = await gql<{
        documentOperations: {
          items: {
            index: number;
            timestampUtcMs: string | null;
            error: string | null;
            action: {
              type: string;
              input: Record<string, unknown> | null;
              context: {
                signer: {
                  user: { address: string | null } | null;
                  app: { name: string | null } | null;
                } | null;
              } | null;
            };
          }[];
        };
      }>(
        reactorEndpoint(),
        `query Ops($id: String!, $since: Int, $limit: Int) {
          documentOperations(
            filter: { documentId: $id, scopes: ["global"], sinceRevision: $since }
            paging: { limit: $limit }
          ) {
            items {
              index timestampUtcMs error
              action {
                type input
                context { signer { user { address } app { name } } }
              }
            }
          }
        }`,
        { id: documentId, since: Math.max(0, revision - limit), limit },
      );
      if ("error" in ops) return fail(ops.error);

      const addresses = ops.data.documentOperations.items
        .map((op) => op.action.context?.signer?.user?.address || "")
        .filter((a) => a !== "");
      // Usually one or two people touched a document; a name costs a cached
      // lookup and turns 0xadbA…BcA4 into someone the reader knows.
      const signerNames = await resolveEnsNames(addresses);
      const changes = ops.data.documentOperations.items
        .map((op) => {
          const signer = op.action.context?.signer;
          // Unsigned operations carry an empty address, not a missing one.
          const address = signer?.user?.address || null;
          return {
            revision: op.index + 1,
            at: op.timestampUtcMs,
            action: op.action.type,
            change: summarizeOperation(op.action.type, op.action.input ?? {}),
            by: address,
            byName: address ? (signerNames.get(address) ?? null) : null,
            byShort: address ? shortAddress(address) : null,
            via: signer?.app?.name || null,
            ...(op.error ? { failed: op.error } : {}),
          };
        })
        .reverse();

      // `.at` rather than `[0]`: a document with no global operations is
      // a real case, and the type should say so.
      const newest = changes.at(0);
      const who = newest?.byShort
        ? ` by ${newest.byName ?? newest.byShort}${newest.via ? ` via ${newest.via}` : ""}`
        : newest?.via
          ? ` via ${newest.via}`
          : "";
      return ok(
        {
          documentId: doc.id,
          title: doc.name ?? doc.id,
          documentType: doc.documentType,
          createdAt: doc.createdAtUtcIso,
          lastModifiedAt: doc.lastModifiedAtUtcIso,
          revision,
          changes,
        },
        `read the last ${changes.length} of ${revision} change${revision === 1 ? "" : "s"} to "${doc.name ?? documentId}"` +
          (newest ? ` — newest: ${newest.change}${who}` : ""),
      );
    }

    case "read_document": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("read_document needs a documentId");
      const offset = nonNegativeInt(args, "offset");
      const gone = await notInVault(driveId, documentId);
      if (gone) return fail(gone);
      const read = await readDoc(documentId);
      if ("error" in read) return fail(read.error);
      const { doc } = read;

      // Projects and work breakdowns are structured, not prose: render them
      // as an outline with their links resolved rather than paging a field.
      if (doc.documentType === "powerhouse/scopeofwork") {
        const g = scopeState(doc.state);
        const wbsRefs = g.projects.map((e) => e.wbsRef).filter((x): x is string => Boolean(x));
        const allRefs = g.projects.flatMap((e) => envelopeRefs(e));
        const [wbsReads, titles] = await Promise.all([
          Promise.all(wbsRefs.map((id) => readDoc(id))),
          noteTitles(driveId, allRefs, LIMITS.knowledgeRefTitles),
        ]);
        const wbsById = new Map<string, WorkBreakdownStructureState>();
        wbsRefs.forEach((id, i) => {
          const r = wbsReads[i];
          if (!("error" in r)) wbsById.set(id, wbsState(r.doc.state));
        });
        const view = renderScope({ id: doc.id, scope: g, wbsById, noteTitles: titles });
        return ok(
          { text: view.text, ...view.data },
          `read scope of work "${g.title || doc.name || documentId}" (${g.status}, ${view.data.envelopes.length} envelopes, ${view.data.deliverables.delivered}/${view.data.deliverables.total} delivered)`,
        );
      }


      if (doc.documentType === "bai/wbs") {
        const w = wbsState(doc.state);
        // The work breakdown delivers an envelope inside a scope of work.
        const scopeRead = w.sowRef ? await readDoc(w.sowRef) : null;
        const projectName =
          scopeRead && !("error" in scopeRead)
            ? (scopeState(scopeRead.doc.state).projects.find((e) => e.id === w.sowProjectId)?.title ?? null)
            : null;
        const view = renderWbs(w, { id: doc.id, projectName });
        return ok(
          {
            text: view.text,
            ...view.data,
            title: doc.name ?? view.data.title,
          },
          `read work breakdown${projectName ? ` for "${projectName}"` : ""} (${view.data.progress.completed}/${view.data.progress.total} goals done)`,
        );
      }

      const global = (doc.state.global ?? {}) as Record<string, unknown>;
      // Models name their body differently; take the first non-empty.
      const textField =
        (["content", "orientation", "description"] as const).find((f) => {
          const v = global[f];
          return typeof v === "string" && v.trim().length > 0;
        }) ?? null;
      const candidate = textField ? global[textField] : "";
      const full = typeof candidate === "string" ? candidate : "";
      const text = full.slice(offset, offset + LIMITS.documentWindow);
      const hasMore = offset + text.length < full.length;

      // Everything except the paged field, compacted so a source's
      // extractedClaims stays traversable without a 500-element dump.
      const meta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(global)) {
        if (k === textField) continue;
        if (Array.isArray(v)) {
          meta[k] = { count: v.length, first: v.slice(0, LIMITS.metaArray) };
        } else if (typeof v === "string") {
          meta[k] =
            v.length > LIMITS.metaString
              ? `${v.slice(0, LIMITS.metaString)}…`
              : v;
        } else {
          meta[k] = v;
        }
      }

      const stateTitle = global.title;
      return ok(
        {
          documentId: doc.id,
          title:
            (typeof stateTitle === "string" && stateTitle.trim()) ||
            doc.name ||
            doc.id,
          documentType: doc.documentType,
          textField,
          text,
          offset,
          totalChars: full.length,
          hasMore,
          nextOffset: hasMore ? offset + text.length : null,
          meta,
        },
        `read ${doc.documentType ?? "document"} "${doc.name ?? documentId}"${offset > 0 ? ` from ${offset}` : ""}${hasMore ? " (more available)" : ""}`,
      );
    }

    default:
      return fail(`unknown tool "${name}"`);
  }
}
