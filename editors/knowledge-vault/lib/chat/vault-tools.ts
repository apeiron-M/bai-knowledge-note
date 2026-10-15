/**
 * The chat's tool surface over the vault: read-only queries (VAULT_TOOLS),
 * plus three that look outside it (WEB_TOOLS).
 *
 * Read-only is enforced structurally, not by instruction. `executeTool` is a
 * fixed switch over these names; there is no path from a model-supplied
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
import { authHeaders } from "../../../shared/authed-fetch.js";
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
import type { TreeNode } from "../source-tree.js";
import { WBS_TYPE, checkProposal, formToChanges, isNewRef, workCatalog, type CheckResult, type LoadedDocument } from "./work-changes.js";
import {
  buildTopicMap,
  findMatch,
  queryPhrase,
  queryWords,
  rarestWord,
  resolveMap,
  shapeContradictions,
  type MocLinks,
  type MocNode,
  type TensionNode,
  type TensionStatus,
} from "./vault-structure.js";
import {
  browseSources,
  buildSourceLibrary,
  summarizeSources,
  type SourceDocument,
  type SourceLibrary,
} from "./source-library.js";

export type ToolResult =
  /** `forModel`, when set, is what the model reads instead of `data` — a short account of something the UI keeps whole. */
  | { ok: true; data: unknown; summary: string; forModel?: unknown }
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
  /**
   * Neighbours PER HIT: how many to read, and how many the model then sees.
   *
   * These differ on purpose. `contested` is only trustworthy if it is computed
   * over the whole neighbourhood, because per-hit lists inherit the GLOBAL
   * ranking: a note several hits point at weakly (RELATES_TO, x5 = 3.52)
   * outranks a note one hit CONTRADICTS (1.44), so a small cap silently drops
   * the contradiction and `contested` comes back empty. A "read this first"
   * signal that can be quietly wrong is worse than no signal.
   *
   * So: read `scan` per hit and detect over all of it, then show `show` rows.
   * The wider read costs no extra query — the server slices one neighbourhood
   * it has already loaded — and the trim keeps the model's context bounded.
   */
  searchRelated: { scan: 15, show: 12 },
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
  sources: { default: 50, max: 200 },
  /** Notes read_notes reads in one call. */
  readMany: 8,
  /** Search hits that come with their text, and how much of it. */
  searchBodies: 3,
  /** Search hits that name the source they were extracted from. */
  searchSources: 5,
  searchBodyChars: 3000,
  /** `scan`: how widely the words-anywhere fallback looks before filtering. */
  keyword: { default: 10, max: 30, scan: 100 },
  byStatus: { default: 25, max: 100 },
  contradictions: { default: 20, max: 50 },
  mapNotes: { default: 50, max: 200 },
  /** Maps read per vault, and per request when their links are fetched. */
  maps: 400,
  /** Above this many maps the hierarchy is listed without descriptions. */
  mapDescriptions: 40,
  mapsPerRequest: 100,
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
        "Default entry point. Semantic search over the vault's knowledge notes, maps of content, tensions, observations, scopes of work and work breakdowns. Pass the user's question or a short phrase as-is. Returns three things: `hits`, ranked with a 0–1 similarity; `related`, the notes ONE link from those hits with the edge that reached each one (`via`, written from -> to) and `hitCount`, how many hits point at it — a high hitCount means several results agree it matters; and `contested`, any hit that another note CONTRADICTS or SUPERSEDES. READ `contested` FIRST: it means a hit is disputed or stale, so answering from that hit alone would be wrong, not merely thin — say the claim is disputed and cite both sides. `related` already gives you the graph around the answer, so you do NOT need linked_notes for the common case; reach for it only to see ALL edges of one specific note. The top three hits come with their text (`content`, each note sent once per answer), so you can answer from them directly; read_notes reads more at once. The top hits also name the source they were extracted from (`source`); read_document reads it when the question needs the original's detail. Use read_document on a hit whose status is SCOPE or WBS (a project or goal tree — its real state is in noteType). Does NOT search sources — use list_documents for those. ARCHIVED notes — claims the vault no longer holds as current — are excluded unless includeArchived is true; set it only when the user asks what the vault USED to say.",
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
      name: "keyword_search",
      description:
        "Find documents containing an exact word or phrase — a name, figure, acronym or quoted term — in their title, description or body; case-insensitive. Call it beside search_vault, which ranks by meaning and can miss an exact name or number. When the phrase appears nowhere, its words are matched anywhere in a document (`match` says which). Not for sources: list_sources with query. Hits carry documentId, title, documentType, matchedIn and a snippet around the match; read_note for the whole note.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The word or phrase, as written.",
          },
          limit: {
            type: "integer",
            description: `Documents to return (default ${LIMITS.keyword.default}, max ${LIMITS.keyword.max}).`,
          },
          includeArchived: {
            type: "boolean",
            description: "Also search ARCHIVED notes.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notes_by_status",
      description:
        "Notes at one stage, newest edit first, with the count at every stage: DRAFT, IN_REVIEW (waiting for a person to check), CANONICAL (approved), ARCHIVED (retired). For 'what is waiting for my review', 'how many notes are approved' — never estimate these from search. Narrow with topic (exact name from list_topics) or since (ISO date).",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["DRAFT", "IN_REVIEW", "CANONICAL", "ARCHIVED"],
            description: "Default IN_REVIEW.",
          },
          topic: { type: "string" },
          since: {
            type: "string",
            description: "ISO 8601 date or date-time.",
          },
          limit: {
            type: "integer",
            description: `Notes to return (default ${LIMITS.byStatus.default}, max ${LIMITS.byStatus.max}).`,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contradictions",
      description:
        "Recorded disagreements between notes (bai/tension), opened when a note CONTRADICTS another: counts by status — OPEN (undecided, both claims stand), RESOLVED (one side was right), DISSOLVED (both hold, in different contexts) — and, for the status asked, both notes involved and the two claims. read_document on one for its analysis and resolution.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["OPEN", "RESOLVED", "DISSOLVED", "ALL"],
            description: "Default OPEN.",
          },
          limit: {
            type: "integer",
            description: `Contradictions to return (default ${LIMITS.contradictions.default}, max ${LIMITS.contradictions.max}).`,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "topic_maps",
      description:
        "How the notes are organised by theme: the maps of content (bai/moc) — one HUB, DOMAIN maps for areas, TOPIC maps for clusters, each holding notes as CORE_IDEA. Not list_topics, which lists the tags on notes. Without map: the whole hierarchy, top first, each row with tier, depth, parentId and note counts, plus maps attached to nothing. With map (a documentId or title): where it sits, its child maps and the notes it holds.",
      parameters: {
        type: "object",
        properties: {
          map: {
            type: "string",
            description: "A documentId or title; omit for the hierarchy.",
          },
          limit: {
            type: "integer",
            description: `Notes to list when opening a map (default ${LIMITS.mapNotes.default}, max ${LIMITS.mapNotes.max}).`,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Read one knowledge note or map of content in full: the whole body, topics, status, author. Use after search_vault to ground an answer in what the note actually says. Its source — the document it was extracted from — is its DERIVED_FROM link in linked_notes.",
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
      name: "read_notes",
      description:
        "Read several knowledge notes or maps of content in full at once — whole bodies, topics, status, author — by documentId. Read the notes an answer rests on in one step rather than one read_note each.",
      parameters: {
        type: "object",
        properties: {
          documentIds: {
            type: "array",
            items: { type: "string" },
            description: `documentIds from earlier results, at most ${LIMITS.readMany}.`,
          },
        },
        required: ["documentIds"],
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
        "Size and shape of the vault: notes, maps, links, orphans, open tensions, density — and the sources, which no other count covers: how many, by status, kind (sourceType) and original file type, notes extracted from them, and the folders under /sources with their counts. For 'how big is this', 'how many sources', 'what kinds', 'what folders are in sources'.",
      parameters: {
        type: "object",
        properties: {
          sources: {
            type: "boolean",
            description: "Include the sources (default true). False skips reading them, for a faster answer about the notes alone.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_documents",
      description: `List documents of one type with their documentId and title — for the kinds the graph index does not cover: the health report, the pipeline queue, the vault config. For sources (bai/source) prefer list_sources, which knows their folders, status and kind; this still finds one by title. Pass nameContains to find a document by title. Every documentId returned is citable as [[documentId]]. Valid types: ${DOCUMENT_TYPES.join(", ")}.`,
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
      name: "list_sources",
      description:
        "Browse the sources — the long documents notes were extracted from — by folder, as the Sources view shows them: folders under /sources, usually one per topic and one per original file holding its parts. Without folder: the top-level folders and the sources in no folder. folder (a name, a path like \"Reports/2026\", or a folderId) opens one; recursive lists everything beneath it. Filter by status, sourceType, or query (words in a title, description, author, url or folder name; matching folders are returned too). Rows: documentId (cite it; read_document reads it), title, description, status, sourceType, fileType, claimCount, folder. Never cite a folderId.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Folder name, path or folderId; omit for /sources.",
          },
          recursive: {
            type: "boolean",
            description: "Every source beneath the folder, at any depth.",
          },
          status: {
            type: "string",
            enum: ["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"],
          },
          sourceType: {
            type: "string",
            enum: ["ARTICLE", "PAPER", "BOOK_CHAPTER", "TRANSCRIPT", "DOCUMENTATION", "CONVERSATION", "WEB_PAGE", "MANUAL_ENTRY"],
          },
          query: {
            type: "string",
            description: "Words to look for.",
          },
          limit: {
            type: "integer",
            description: `Sources to return (default ${LIMITS.sources.default}, max ${LIMITS.sources.max}).`,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description:
        "Every project in the vault. Projects are envelopes inside scope-of-work documents (powerhouse/scopeofwork). ONE ROW IS ONE PROJECT: `project` is its name, with `code`, `status`, `owner`, `envelopeId`, and `cite` — the anchored marker [[scopeId#envelopeId]] that cites this one project. `scope` is the document HOLDING it ({documentId, title}) — several projects share one scope, so the scope title is NOT the project name and must never be listed as a project in its own right. Each row also carries `progress` as {delivered, total, pct}. Report BOTH when you state progress — for example, 6 of 10 delivered and 74% of the work — because they measure different things: `delivered`/`total` counts deliverables that are finished (closed ones are excluded from both), while `pct` averages how far each open deliverable has got. A project can legitimately read 0 of 3 delivered at 39%, and a bare percentage hides that. It also carries budget (type, currency, stored budget, fixed target if any, Σ quoted lines), cited-knowledge count, and `wbs`, the work breakdown that delivers this project — use its `cite` to open that breakdown INSIDE the scope, which is what a reader asking about the work wants; `wbs.documentId` opens the standalone WBS editor instead. Cite exactly one project per row and never repeat a project under a second name. Start here for any question about projects, deliverables, goals or who is working on what; then read_document on scope.documentId for the full outline. Cite a project with its `cite` marker, or the scope as [[scope.documentId]] — the UUID, never a name.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["DRAFT", "TODO", "IN_PROGRESS", "FINISHED", "CANCELED"],
            description: "Only projects in this state.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Read any document by documentId. For a powerhouse/scopeofwork this returns the whole scope as one outline (text) plus structured data: status, every envelope (code, title, owner, set status and progress, budget type/currency, fixed or quote-derived budget, spend, references, cited knowledge with titles, linked WBS and its goal progress), every deliverable with status, owner, progress, quote (quantity × unit cost, margin), milestone and the WBS goal that delivers it, the deliverables no envelope funds, roadmaps and milestones (date, status, coordinators, budget, deliverables), and contributors. For a bai/wbs it returns the goal tree with block reasons, outcomes and notes. For everything else (notably bai/source) it returns metadata plus an 8,000-character window of the main text starting at offset; when hasMore is true, call again with nextOffset. A source's metadata includes extractedClaims — ids of notes derived from it — which you can read_note. The other direction is a note's DERIVED_FROM link, which linked_notes returns. Every result carries the documentId you cite it by.",
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
      headers: await authHeaders(),
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

/** How many cited notes the save form reads topics from. */
const TOPIC_SOURCES = 12;

/**
 * The topics of a few notes, in one aliased request. `topics` is a per-node
 * resolver, so this stays small on purpose: it is what the save form reads to
 * suggest a saved answer's topics from the notes the answer cited. A note the
 * index does not know is absent; a failed read is an empty map.
 */
export async function noteTopics(
  driveId: string,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const wanted = ids.slice(0, TOPIC_SOURCES);
  const out = new Map<string, string[]>();
  if (wanted.length === 0) return out;
  const aliases = wanted
    .map((_, i) => `n${i}: knowledgeGraphNodeByDocumentId(driveId: $driveId, documentId: $d${i}) { topics }`)
    .join("\n");
  const vars = wanted.map((_, i) => `$d${i}: String!`).join(", ");
  const variables: Record<string, unknown> = { driveId };
  wanted.forEach((id, i) => {
    variables[`d${i}`] = id;
  });
  const r = await gql<Record<string, { topics: string[] | null } | null>>(
    graphEndpoint(),
    `query NTop($driveId: ID!, ${vars}) { ${aliases} }`,
    variables,
  );
  if ("error" in r) return out;
  wanted.forEach((id, i) => {
    const topics = r.data[`n${i}`]?.topics;
    if (topics && topics.length > 0) out.set(id, topics);
  });
  return out;
}

/** One outgoing edge, as the batched forward-links read returns it. */
interface ForwardEdge {
  targetDocumentId: string;
  linkType: string | null;
  targetTitle: string | null;
}

/**
 * The outgoing edges of many documents, a hundred to a request, all requests
 * in flight together — rather than one request per document. A document
 * whose edges could not be read is absent from the map; the whole read fails
 * only when every request did.
 */
async function forwardLinksOf(
  driveId: string,
  ids: string[],
): Promise<Map<string, ForwardEdge[]> | { error: string }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LIMITS.mapsPerRequest) {
    chunks.push(ids.slice(i, i + LIMITS.mapsPerRequest));
  }
  const reads = await Promise.all(
    chunks.map((chunk) => {
      const aliases = chunk
        .map(
          (_, i) =>
            `l${i}: knowledgeGraphForwardLinks(driveId: $driveId, documentId: $d${i}) { targetDocumentId linkType targetTitle }`,
        )
        .join("\n");
      const vars = chunk.map((_, i) => `$d${i}: String!`).join(", ");
      const variables: Record<string, unknown> = { driveId };
      chunk.forEach((id, i) => {
        variables[`d${i}`] = id;
      });
      return gql<Record<string, ForwardEdge[] | null>>(
        graphEndpoint(),
        `query FL($driveId: ID!, ${vars}) { ${aliases} }`,
        variables,
      );
    }),
  );
  const out = new Map<string, ForwardEdge[]>();
  const failures: string[] = [];
  reads.forEach((r, c) => {
    if ("error" in r) {
      failures.push(r.error);
      return;
    }
    chunks[c].forEach((id, i) => {
      const edges = r.data[`l${i}`];
      if (edges) out.set(id, edges);
    });
  });
  if (failures.length > 0 && out.size === 0 && ids.length > 0) return { error: failures[0] };
  return out;
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

/**
 * Changing work: scopes of work, their projects, and the work breakdowns that
 * deliver them. Proposals only — the chat shows them as a card and the person
 * applies them (work-changes.ts, use-work-proposal.ts). Kept out of
 * VAULT_TOOLS: Connect's own assistant has no card to confirm on.
 */
export const WORK_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "work_operations",
      description:
        "What you can change in scopes of work, their projects (envelopes) and work breakdowns: the four kinds of change propose_work_changes takes, and every operation with its input fields and allowed values, read from the document models. Call it before proposing changes.",
      parameters: {
        type: "object",
        properties: {
          area: {
            type: "string",
            enum: ["scope", "wbs", "all"],
            description: "scope: scopes and projects; wbs: work breakdowns and goals. Default all.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_work_changes",
      description:
        'Propose changes to scopes of work, projects and work breakdowns — create, change or delete — as a form: one list per kind of change, applied in the order below. Nothing is written: the person sees the changes as a card under your answer and applies or cancels them. Every change is checked first; one with a problem comes back with what to fix. Read existing work first (list_projects, read_document) for the ids that exist; give anything new a ref new:<name> and use that ref wherever its id is needed. A complete scope: a project, its breakdown and goals, a deliverable, and a roadmap whose milestone schedules it: {"summary":"Set up Operations 2027","scopes":[{"ref":"new:ops","title":"Operations 2027"}],"projects":[{"scope":"new:ops","ref":"new:infra","code":"INF","title":"Infrastructure","owner":"Bob","budgetType":"OPEX","currency":"EUR"}],"breakdowns":[{"ref":"new:plan","name":"Infrastructure plan","scope":"new:ops","project":"new:infra"}],"goals":[{"wbs":"new:plan","ref":"new:servers","description":"Provision servers"},{"wbs":"new:plan","description":"Point the domain","parent":"new:servers"}],"deliverables":[{"scope":"new:ops","project":"new:infra","ref":"new:live","code":"INF-1","title":"Servers in production"}],"roadmaps":[{"scope":"new:ops","ref":"new:launch","title":"2027 launch"}],"milestones":[{"roadmap":"new:launch","code":"M1","title":"Servers live","target":"2027-03-31","deliverables":["new:live"]}]}',
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One sentence: what these changes do, for the person." },
          scopes: {
            type: "array",
            description: "New scopes of work. Only when no existing scope fits — one per team or programme.",
            items: {
              type: "object",
              properties: {
                ref: { type: "string", description: "new:<name>, to refer to it below." },
                title: { type: "string", description: "The scope's title." },
                description: { type: "string", description: "What it scopes." },
              },
              required: ["title"],
            },
          },
          projects: {
            type: "array",
            description: "Projects (envelopes), each inside a scope.",
            items: {
              type: "object",
              properties: {
                scope: { type: "string", description: "The scope: its documentId, or its new:<name> from scopes." },
                ref: { type: "string", description: "new:<name>, to refer to this project below." },
                code: { type: "string", description: "A short code, e.g. INF." },
                title: { type: "string", description: "The project's name." },
                owner: { type: "string", description: "Who owns it, by name." },
                budgetType: { type: "string", enum: ["OPEX", "CAPEX", "CONTINGENCY", "OVERHEAD"] },
                currency: { type: "string", enum: ["USD", "EUR", "DAI", "USDS"] },
                budget: { type: "number", description: "A fixed budget. Omit to derive it from the deliverables' quotes." },
              },
              required: ["scope", "code", "title"],
            },
          },
          breakdowns: {
            type: "array",
            description: "Work breakdowns: the goal tree that delivers one project. A goal is not a breakdown — goals go in goals.",
            items: {
              type: "object",
              properties: {
                ref: { type: "string", description: "new:<name>, to refer to it in goals." },
                name: { type: "string", description: "Its name." },
                scope: { type: "string", description: "The scope holding the project: documentId or new:<name>." },
                project: { type: "string", description: "The project it delivers: its id in the scope, or its new:<name> from projects." },
                owner: { type: "string", description: "Who owns the work, by name." },
              },
              required: ["name"],
            },
          },
          goals: {
            type: "array",
            description: "Goals in a work breakdown, parents before children.",
            items: {
              type: "object",
              properties: {
                wbs: { type: "string", description: "The work breakdown: its documentId, or its new:<name> from breakdowns." },
                ref: { type: "string", description: "new:<name>, to put another goal under this one." },
                description: { type: "string", description: "The goal itself, in a sentence." },
                parent: { type: "string", description: "The goal it sits under: its id or new:<name>. Omit for a top-level goal." },
                assignee: { type: "string", description: "Who works on it, by name." },
              },
              required: ["wbs", "description"],
            },
          },
          deliverables: {
            type: "array",
            description: "Deliverables a project funds.",
            items: {
              type: "object",
              properties: {
                scope: { type: "string", description: "The scope: documentId or new:<name>." },
                project: { type: "string", description: "The project: its id in the scope, or its new:<name> from projects." },
                ref: { type: "string", description: "new:<name>, to refer to it in operations." },
                title: { type: "string", description: "What is delivered." },
                code: { type: "string", description: "A short code, e.g. INF-1." },
                description: { type: "string", description: "What it covers." },
                owner: { type: "string", description: "Who owns it, by name." },
                status: { type: "string", enum: ["DRAFT", "TODO", "IN_PROGRESS", "BLOCKED", "DELIVERED", "CANCELED", "WONT_DO"] },
              },
              required: ["scope", "project", "title"],
            },
          },
          roadmaps: {
            type: "array",
            description: "Roadmaps in a scope: the schedule its milestones sit on.",
            items: {
              type: "object",
              properties: {
                scope: { type: "string", description: "The scope: documentId or new:<name>." },
                ref: { type: "string", description: "new:<name>, to put milestones on it." },
                title: { type: "string", description: "Its name, e.g. 2027 launch." },
                description: { type: "string", description: "What it plans." },
              },
              required: ["scope", "title"],
            },
          },
          milestones: {
            type: "array",
            description: "Milestones on a roadmap, in order, each scheduling the deliverables due by it.",
            items: {
              type: "object",
              properties: {
                roadmap: { type: "string", description: "The roadmap: its id, or its new:<name> from roadmaps." },
                scope: { type: "string", description: "The scope, when the roadmap already exists: its documentId." },
                ref: { type: "string", description: "new:<name>, to refer to it in operations." },
                code: { type: "string", description: "A short code, e.g. M1." },
                title: { type: "string", description: "What is reached, e.g. Servers live." },
                target: { type: "string", description: "Its date, YYYY-MM-DD." },
                description: { type: "string", description: "What it means to reach it." },
                coordinator: { type: "string", description: "Who coordinates it, by name." },
                deliverables: { type: "array", items: { type: "string" }, description: "The deliverables it schedules: refs, ids, codes or titles." },
              },
              required: ["roadmap", "title"],
            },
          },
          operations: {
            type: "array",
            description: "Anything else — edits, statuses, key results, removals: one model operation each (work_operations lists them with their inputs).",
            items: {
              type: "object",
              properties: {
                document: { type: "string", description: "The scope or work breakdown: documentId or new:<name>." },
                type: { type: "string", description: "The operation, e.g. EDIT_DELIVERABLE." },
                input: { type: "string", description: 'Its input as a JSON object, e.g. {"id":"d1","status":"IN_PROGRESS"}.' },
              },
              required: ["document", "type", "input"],
            },
          },
          deletions: {
            type: "array",
            description: "Whole scopes of work or work breakdowns to delete. Only when the person asks.",
            items: {
              type: "object",
              properties: { document: { type: "string", description: "Its documentId." } },
              required: ["document"],
            },
          },
        },
        required: ["summary"],
      },
    },
  },
];

/**
 * A proposal of changes to work, checked: the documents its form names read
 * from the vault — and the scope holding any breakdown it deletes — then the
 * form checked and rehearsed against them. What propose_work_changes runs on
 * the model's form, and what the card runs again on the person's edit of it,
 * so an edit is held to the same rules. `keep` keeps an edited proposal's
 * identity: its id, when it was made, which entries the person changed.
 */
export async function checkWorkProposal(
  form: Record<string, unknown>,
  driveId: string,
  keep?: { id: string; createdAt: string; edited?: readonly string[] },
): Promise<CheckResult> {
  const changes = formToChanges(form);
  // The documents the proposal names, read for their names and current
  // contents: the card says "project KV “Knowledge Vault”", and a deletion
  // says what else it takes with it.
  const members = await driveMembers(driveId);
  const wanted = new Set<string>();
  for (const c of changes) {
    for (const key of ["document", "scope", "wbs"] as const) {
      const v = typeof c[key] === "string" ? c[key].trim() : "";
      if (v && !isNewRef(v)) wanted.add(v);
    }
  }
  const docs = new Map<string, LoadedDocument>();
  const load = (ids: Iterable<string>) =>
    Promise.all(
      [...ids].map(async (id) => {
        const member = members?.get(id);
        // Not in the vault's tree: deleted, or another drive's — never offered.
        if (members && !member) return;
        const read = await readDoc(id);
        if ("error" in read) return;
        docs.set(id, {
          documentId: id,
          documentType: read.doc.documentType ?? member?.documentType ?? "",
          name: read.doc.name ?? member?.name ?? null,
          state: ((read.doc.state as { global?: unknown }).global ?? null) as Record<string, unknown> | null,
        });
      }),
    );
  await load(wanted);
  // A breakdown to delete is unlinked from its project first: read the scope that holds it.
  const holders = new Set<string>();
  for (const c of changes) {
    const d = c.kind === "delete_document" && typeof c.document === "string" ? docs.get(c.document.trim()) : undefined;
    const sowRef = (d?.state as { sowRef?: unknown } | null | undefined)?.sowRef;
    if (d?.documentType === WBS_TYPE && typeof sowRef === "string" && !docs.has(sowRef)) holders.add(sowRef);
  }
  if (holders.size) await load(holders);
  const checked = keep
    ? checkProposal({ summary: form.summary, changes }, docs, () => keep.createdAt, () => keep.id, keep.edited ?? [])
    : checkProposal({ summary: form.summary, changes }, docs);
  if (!checked.ok) return checked;
  return { ok: true, proposal: { ...checked.proposal, form, ...(keep?.edited?.length ? { edited: [...keep.edited] } : {}) } };
}

/** Everything the vault's own chat may call: the vault, its work, and the web. */
export const CHAT_TOOLS: ToolSchema[] = [...VAULT_TOOLS, ...WORK_TOOLS, ...WEB_TOOLS];

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
const membersCache = new Map<
  string,
  { at: number; members: Map<string, DriveMember>; nodes: TreeNode[] }
>();

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
  return (await driveTree(driveId))?.members ?? null;
}

/**
 * The drive's whole node list — folders as well as files — with the members
 * derived from it. Folders are what the source library navigates by.
 */
async function driveTree(
  driveId: string,
): Promise<{ members: Map<string, DriveMember>; nodes: TreeNode[] } | null> {
  const cached = membersCache.get(driveId);
  if (cached && Date.now() - cached.at < LISTING_TTL_MS) return cached;
  const tree = await gql<{
    document: { document: { state: unknown } | null } | null;
  }>(
    reactorEndpoint(),
    `query DriveTree($id: String!) { document(idOrSlug: $id) { document { state } } }`,
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
  const treeNodes: TreeNode[] = [];
  for (const raw of nodes as {
    id?: unknown;
    kind?: unknown;
    name?: unknown;
    documentType?: unknown;
    parentFolder?: unknown;
  }[]) {
    const n = raw;
    if (typeof n.id !== "string" || (n.kind !== "file" && n.kind !== "folder")) continue;
    treeNodes.push({
      id: n.id,
      name: typeof n.name === "string" ? n.name : "",
      kind: n.kind,
      ...(typeof n.documentType === "string" ? { documentType: n.documentType } : {}),
      parentFolder: typeof n.parentFolder === "string" && n.parentFolder ? n.parentFolder : null,
    });
    if (n.kind !== "file" || typeof n.documentType !== "string") continue;
    members.set(n.id, {
      name: typeof n.name === "string" && n.name ? n.name : null,
      documentType: n.documentType,
    });
  }
  const entry = { at: Date.now(), members, nodes: treeNodes };
  membersCache.set(driveId, entry);
  return entry;
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

/** Sources the reactor serves per request; the result says when a vault holds more. */
const SOURCES_PAGE = 1000;
const libraryCache = new Map<string, { at: number; library: SourceLibrary; more: boolean }>();

/**
 * Every source in the vault with its state, and the tree that places it.
 *
 * One request for all of them: `findDocuments` narrowed to this drive and to
 * `bai/source`, returning each document's state. That carries every source's
 * text, which is the price of reading `status` and `sourceType` without one
 * request per source — the Sources view pays the same, one document at a
 * time. Nothing of the text reaches the model: the library keeps the fields a
 * row needs and drops the rest. Cached like the listing, so a summary and a
 * browse in the same answer read the vault once.
 */
async function sourceLibrary(
  driveId: string,
): Promise<{ library: SourceLibrary; more: boolean } | { error: string }> {
  const cached = libraryCache.get(driveId);
  if (cached && Date.now() - cached.at < LISTING_TTL_MS) return cached;
  const [tree, found] = await Promise.all([
    driveTree(driveId),
    gql<{
      findDocuments: {
        hasNextPage: boolean;
        items: {
          id: string;
          name: string | null;
          createdAtUtcIso: string | null;
          lastModifiedAtUtcIso: string | null;
          state: unknown;
        }[];
      };
    }>(
      reactorEndpoint(),
      `query Sources($parentId: String!, $limit: Int) {
        findDocuments(search: { type: "bai/source", parentId: $parentId }, paging: { limit: $limit }) {
          hasNextPage items { id name createdAtUtcIso lastModifiedAtUtcIso state }
        }
      }`,
      { parentId: driveId, limit: SOURCES_PAGE },
    ),
  ]);
  if (!tree) return { error: "could not read the drive's folders and files" };
  if ("error" in found) return { error: found.error };
  const documents: SourceDocument[] = found.data.findDocuments.items.map((d) => {
    const raw = typeof d.state === "string" ? (JSON.parse(d.state) as unknown) : d.state;
    const global = ((raw as { global?: unknown } | null)?.global ?? {}) as Record<string, unknown>;
    return {
      id: d.id,
      name: d.name ?? d.id,
      createdAtUtcIso: d.createdAtUtcIso ?? undefined,
      lastModifiedAtUtcIso: d.lastModifiedAtUtcIso ?? undefined,
      global,
    };
  });
  const entry = {
    at: Date.now(),
    library: buildSourceLibrary(tree.nodes, documents),
    more: found.data.findDocuments.hasNextPage,
  };
  libraryCache.set(driveId, entry);
  return entry;
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

/**
 * Note bodies search has already handed the model in this answer. A model
 * that searches five times for the same thing would otherwise be sent the
 * same three bodies five times; once is enough to answer from. Forgotten at
 * the start of each answer, and after a while for callers that never say
 * when one starts (Connect's assistant).
 */
const bodiesSent = new Map<string, number>();
const BODY_MEMORY_MS = 10 * 60_000;
function sentRecently(documentId: string): boolean {
  const at = bodiesSent.get(documentId);
  return at !== undefined && Date.now() - at < BODY_MEMORY_MS;
}

/** Test seam: forget the cached listing and drive membership. */
export function resetVaultDocumentListing(): void {
  listingCache.clear();
  membersCache.clear();
  libraryCache.clear();
  bodiesSent.clear();
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
/*  Search neighbourhood                                              */
/* ------------------------------------------------------------------ */

/** One edge, always written source -> target. */
interface ViaRow {
  from: string;
  to: string;
  linkType: string | null;
  reason: string | null;
}

/** A node one link from a hit, as the graph returns it per hit. */
interface RelatedRow {
  documentId: string;
  title: string | null;
  noteType: string | null;
  documentType: string | null;
  hitCount: number;
  via: ViaRow[];
}

/**
 * A hit whose claim is disputed or replaced by something else in the graph.
 *
 * `documentId` is always the HIT; `direction` says which way the edge runs, so
 * an incoming SUPERSEDES means this hit is the stale one while an outgoing
 * SUPERSEDES means it is the replacement.
 */
interface ContestedRow {
  documentId: string;
  title: string | null;
  linkType: string;
  direction: "incoming" | "outgoing";
  otherDocumentId: string;
  otherTitle: string | null;
  reason: string | null;
}

/** A knowledge note's life: drafted, waiting for review, approved, retired. */
const NOTE_STATUSES = ["DRAFT", "IN_REVIEW", "CANONICAL", "ARCHIVED"] as const;
const STATUS_LABEL: Record<(typeof NOTE_STATUSES)[number], string> = {
  DRAFT: "drafts",
  IN_REVIEW: "waiting for review",
  CANONICAL: "approved",
  ARCHIVED: "archived",
};

/** Link types that change whether an answer is CORRECT, not just how full. */
const CONTESTING = new Set(["CONTRADICTS", "SUPERSEDES"]);

type SearchRow = {
  node: Record<string, unknown>;
  /** Absent on a Switchboard older than the field, so never assumed present. */
  related?: RelatedRow[] | null;
  linkedHits?: ViaRow[] | null;
};

/**
 * Flatten the per-hit neighbourhood into one deduped block, and pull out the
 * hits something disputes.
 *
 * The graph returns `related` per hit, so a node several hits point at arrives
 * several times — measured at 39% repeats over eight hits on this vault. The
 * model pays for every repeat in context, and a repeated node reads as several
 * findings rather than one, so they are merged here with their `via` edges
 * combined and `hitCount` kept as the convergence signal.
 */
function neighbourhoodOf(rows: SearchRow[]): {
  related: RelatedRow[];
  contested: ContestedRow[];
} {
  const titleById = new Map<string, string | null>();
  for (const row of rows) {
    const id = row.node.documentId;
    if (typeof id === "string") {
      titleById.set(
        id,
        typeof row.node.title === "string" ? row.node.title : null,
      );
    }
  }
  const hitIds = new Set(titleById.keys());

  // Merge, preserving first-seen order: hits arrive in rank order and each
  // hit's own list is already globally ranked, so this keeps the strongest
  // neighbours first without re-sorting.
  const merged = new Map<string, RelatedRow>();
  for (const row of rows) {
    for (const rel of row.related ?? []) {
      titleById.set(rel.documentId, rel.title);
      const seen = merged.get(rel.documentId);
      if (!seen) {
        merged.set(rel.documentId, { ...rel, via: [...rel.via] });
        continue;
      }
      for (const via of rel.via) {
        const dup = seen.via.some(
          (v) =>
            v.from === via.from &&
            v.to === via.to &&
            v.linkType === via.linkType,
        );
        if (!dup) seen.via.push(via);
      }
    }
  }

  const contested: ContestedRow[] = [];
  const emitted = new Set<string>();
  const consider = (via: ViaRow) => {
    if (!via.linkType || !CONTESTING.has(via.linkType)) return;
    for (const [end, other, direction] of [
      [via.to, via.from, "incoming"],
      [via.from, via.to, "outgoing"],
    ] as const) {
      if (!hitIds.has(end)) continue;
      const key = `${end}|${other}|${via.linkType}|${direction}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      contested.push({
        documentId: end,
        title: titleById.get(end) ?? null,
        linkType: via.linkType,
        direction,
        otherDocumentId: other,
        otherTitle: titleById.get(other) ?? null,
        reason: via.reason,
      });
    }
  };
  // Both populations: an edge to a neighbour, and an edge to another hit.
  // The second is the one `related` can never carry, and the one most likely
  // to matter — semantic search returns both sides of a disagreement.
  for (const row of merged.values()) for (const via of row.via) consider(via);
  for (const row of rows) for (const via of row.linkedHits ?? []) consider(via);

  // Trim AFTER detection, never before. Rows involved in a contradiction are
  // pinned to the front: the model is told to read them first, so it must be
  // able to see what they say.
  const all = [...merged.values()];
  const contestedIds = new Set(contested.flatMap((c) => [c.documentId, c.otherDocumentId]));
  const pinned = all.filter((r) => contestedIds.has(r.documentId));
  const rest = all.filter((r) => !contestedIds.has(r.documentId));
  const related = [...pinned, ...rest].slice(0, LIMITS.searchRelated.show);

  return { related, contested };
}

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
          related?: RelatedRow[] | null;
          linkedHits?: ViaRow[] | null;
        }[];
      }>(
        graphEndpoint(),
        // `related` is the neighbourhood AROUND the hits; `linkedHits` the
        // edges BETWEEN them. Both are needed: search returns both sides of a
        // disagreement often enough that the CONTRADICTS joining two hits
        // would otherwise be the one thing nobody sees. Neither costs a query
        // per hit — the server reads the neighbourhood once and slices it.
        `query S($driveId: ID!, $query: String!, $limit: Int, $includeArchived: Boolean) {
          knowledgeGraphSemanticSearch(driveId: $driveId, query: $query, mode: SEMANTIC, limit: $limit, includeArchived: $includeArchived) {
            similarity matchedBy node { ${NOTE_FIELDS} content }
            related(limit: ${LIMITS.searchRelated.scan}) { documentId title noteType documentType hitCount via { from to linkType reason } }
            linkedHits { from to linkType reason }
          }
        }`,
        { driveId, query, limit, includeArchived },
      );
      if ("error" in r) return fail(r.error);
      const raw = r.data.knowledgeGraphSemanticSearch;
      // The top hits carry their text, so an answer can be written from them
      // without another round; the rest stay light. A body already sent this
      // answer is not sent again.
      let bodies = 0;
      const hits: Record<string, unknown>[] = raw.map((h) => {
        const { content, ...node } = h.node;
        const id = typeof node.documentId === "string" ? node.documentId : "";
        const text = typeof content === "string" ? content : "";
        const withBody = bodies < LIMITS.searchBodies && text.trim() !== "" && id !== "" && !sentRecently(id);
        if (withBody) {
          bodies++;
          bodiesSent.set(id, Date.now());
        }
        return {
          ...node,
          similarity: Number(h.similarity.toFixed(3)),
          matchedBy: h.matchedBy,
          ...(withBody
            ? text.length > LIMITS.searchBodyChars
              ? { content: text.slice(0, LIMITS.searchBodyChars), contentTruncated: true }
              : { content: text }
            : {}),
        };
      });
      const { related, contested } = neighbourhoodOf(raw);
      // Where each top hit came from: the source it was extracted from (its
      // DERIVED_FROM link). A note is a claim drawn from a longer text; when a
      // question needs that text's detail — an order it recommends, a worked
      // example — the model can read the source itself. One batched request.
      const topIds = hits
        .slice(0, LIMITS.searchSources)
        .map((h) => h.documentId)
        .filter((id): id is string => typeof id === "string");
      const [links, members] = await Promise.all([forwardLinksOf(driveId, topIds), driveMembers(driveId)]);
      if (!("error" in links)) {
        for (const h of hits) {
          const id = typeof h.documentId === "string" ? h.documentId : "";
          const from = (links.get(id) ?? [])
            .filter((e) => e.linkType === "DERIVED_FROM")
            .map((e) => ({
              documentId: e.targetDocumentId,
              title: e.targetTitle ?? members?.get(e.targetDocumentId)?.name ?? e.targetDocumentId,
              documentType: members?.get(e.targetDocumentId)?.documentType ?? "bai/source",
            }));
          if (from.length > 0) Object.assign(h, { source: from.length === 1 ? from[0] : from });
        }
      }
      return ok(
        { hits, related, contested },
        `searched "${query}" → ${hits.length} note${hits.length === 1 ? "" : "s"}` +
          (related.length ? `, ${related.length} connected` : "") +
          (contested.length
            ? `, ${contested.length} CONTESTED — read the contradiction before answering`
            : ""),
      );
    }

    case "work_operations": {
      const area = str(args, "area");
      const catalog = workCatalog(area === "scope" || area === "wbs" ? area : "all");
      return ok(catalog, `listed ${catalog.operations.length} operations on scopes of work and work breakdowns`);
    }

    case "propose_work_changes": {
      const checked = await checkWorkProposal(args, driveId);
      if (!checked.ok) {
        return fail(`Nothing was proposed. Fix these and propose again: ${checked.errors.join(" ")}`);
      }
      const p = checked.proposal;
      const shown =
        "The person now sees these changes as a card under your answer, with Apply and Cancel, and can edit them first. Nothing has changed yet — say what you proposed in a sentence or two; do not repeat the list.";
      return {
        ok: true,
        data: { proposal: p, shown },
        // The model reads what it proposed in words; the card keeps the whole proposal, its form included.
        forModel: { proposed: p.changes.map((c) => c.says), shown },
        summary: `proposed ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}${p.deletions ? ` (${p.deletions} removing something)` : ""}: ${p.changes.map((c) => c.says).join("; ").slice(0, 300)}`,
      };
    }

    case "keyword_search": {
      const query = str(args, "query");
      if (!query) return fail("keyword_search needs a word or phrase");
      const phrase = queryPhrase(query);
      if (!phrase) return fail("keyword_search needs a word or phrase");
      const limit = int(args, "limit", LIMITS.keyword.default, LIMITS.keyword.max);
      const includeArchived = bool(args, "includeArchived");
      // `content` is read to cut a snippet from, and never sent on.
      const run = (q: string, n: number) =>
        gql<{ knowledgeGraphFullSearch: Record<string, unknown>[] }>(
          graphEndpoint(),
          `query K($driveId: ID!, $query: String!, $limit: Int, $includeArchived: Boolean) {
            knowledgeGraphFullSearch(driveId: $driveId, query: $query, limit: $limit, includeArchived: $includeArchived) {
              ${NOTE_FIELDS} content updatedAt
            }
          }`,
          { driveId, query: q, limit: n, includeArchived },
        );
      const asPhrase = await run(phrase, limit);
      if ("error" in asPhrase) return fail(asPhrase.error);
      let rows = asPhrase.data.knowledgeGraphFullSearch;
      let mode: "phrase" | "all words" = "phrase";
      // The index matches the phrase as written. "gas turbine backlog" is
      // rarely written that way, so when the phrase finds nothing, look for
      // the most telling word and keep what contains all of them.
      const anchor = rarestWord(query);
      if (rows.length === 0 && queryWords(query).length > 1 && anchor) {
        const wide = await run(anchor, LIMITS.keyword.scan);
        if ("error" in wide) return fail(wide.error);
        rows = wide.data.knowledgeGraphFullSearch;
        mode = "all words";
      }
      const s = (v: unknown) => (typeof v === "string" ? v : null);
      const hits = rows
        .map((node) => {
          const m = findMatch(
            { title: s(node.title), description: s(node.description), content: s(node.content) },
            query,
          );
          if (!m) return null;
          return {
            documentId: node.documentId,
            title: node.title,
            documentType: node.documentType,
            noteType: node.noteType,
            status: node.status,
            matchedIn: m.matchedIn,
            snippet: m.snippet,
            updatedAt: node.updatedAt,
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null)
        .slice(0, limit);
      return ok(
        { query, match: mode, hits },
        hits.length === 0
          ? `no document contains "${query}"${queryWords(query).length > 1 ? " — as a phrase or word by word" : ""}`
          : `"${query}" ${mode === "phrase" ? "appears" : "— all its words appear —"} in ${hits.length} document${hits.length === 1 ? "" : "s"}`,
      );
    }

    case "notes_by_status": {
      const status = (str(args, "status") ?? "IN_REVIEW").toUpperCase();
      if (!(NOTE_STATUSES as readonly string[]).includes(status)) {
        return fail(`status must be one of: ${NOTE_STATUSES.join(", ")}`);
      }
      const limit = int(args, "limit", LIMITS.byStatus.default, LIMITS.byStatus.max);
      const topic = str(args, "topic");
      const sinceRaw = str(args, "since");
      let since: string | null = null;
      if (sinceRaw) {
        const t = Date.parse(sinceRaw);
        if (Number.isNaN(t)) return fail(`since must be an ISO 8601 date, e.g. 2026-09-01 — got "${sinceRaw}"`);
        since = new Date(t).toISOString();
      }
      // Every status in one request: the full rows for the one asked about,
      // ids for the others, so the counts cost almost nothing.
      const selections = NOTE_STATUSES.map(
        (s) =>
          `${s}: knowledgeGraphNodesByStatus(driveId: $driveId, status: "${s}") { ${
            s === status ? `${NOTE_FIELDS} author updatedAt` : "documentId documentType"
          } }`,
      ).join("\n");
      type Row = Record<string, unknown> & { documentId: string; documentType: string | null };
      const editedAt = (n: Row) => (typeof n.updatedAt === "string" ? n.updatedAt : "");
      const r = await gql<Record<string, Row[] | undefined>>(
        graphEndpoint(),
        `query NS($driveId: ID!${topic ? ", $topic: String!" : ""}) {
          ${selections}
          ${topic ? "inTopic: knowledgeGraphByTopic(driveId: $driveId, topic: $topic, includeArchived: true) { documentId }" : ""}
        }`,
        topic ? { driveId, topic } : { driveId },
      );
      if ("error" in r) return fail(r.error);
      // Research claims carry CANONICAL too; only notes have a review life.
      const notesIn = (s: string) =>
        (r.data[s] ?? []).filter((n) => n.documentType === "bai/knowledge-note");
      const inTopic = topic ? new Set((r.data.inTopic ?? []).map((n) => n.documentId)) : null;
      const counts = Object.fromEntries(
        NOTE_STATUSES.map((s) => [s, notesIn(s).filter((n) => !inTopic || inTopic.has(n.documentId)).length]),
      ) as Record<(typeof NOTE_STATUSES)[number], number>;
      const matching = notesIn(status)
        .filter((n) => !inTopic || inTopic.has(n.documentId))
        .filter((n) => !since || editedAt(n) >= since)
        .sort((a, b) => editedAt(b).localeCompare(editedAt(a)));
      const notes = matching.slice(0, limit).map((n) => ({
        documentId: n.documentId,
        title: n.title,
        documentType: n.documentType,
        description: n.description,
        noteType: n.noteType,
        status: n.status,
        author: n.author,
        updatedAt: n.updatedAt,
      }));
      const label = STATUS_LABEL[status as (typeof NOTE_STATUSES)[number]];
      return ok(
        { status, counts, total: matching.length, notes, ...(topic ? { topic } : {}), ...(since ? { since } : {}) },
        `${matching.length} note${matching.length === 1 ? "" : "s"} ${label}${topic ? ` in #${topic}` : ""}${since ? ` since ${since.slice(0, 10)}` : ""} — ` +
          NOTE_STATUSES.map((s) => `${counts[s]} ${STATUS_LABEL[s]}`).join(", "),
      );
    }

    case "list_contradictions": {
      const want = (str(args, "status") ?? "OPEN").toUpperCase();
      if (!["OPEN", "RESOLVED", "DISSOLVED", "ALL"].includes(want)) {
        return fail("status must be one of: OPEN, RESOLVED, DISSOLVED, ALL");
      }
      const limit = int(args, "limit", LIMITS.contradictions.default, LIMITS.contradictions.max);
      const r = await gql<{ knowledgeGraphNodesByType: TensionNode[] }>(
        graphEndpoint(),
        `query C($driveId: ID!) {
          knowledgeGraphNodesByType(driveId: $driveId, documentType: "bai/tension") {
            documentId title description status author createdAt updatedAt
          }
        }`,
        { driveId },
      );
      if ("error" in r) return fail(r.error);
      const tensions = r.data.knowledgeGraphNodesByType;
      const wanted = want as TensionStatus | "ALL";
      const shown = shapeContradictions(tensions, new Map(), wanted).rows.slice(0, limit);
      // The notes each one is between: its INVOLVES edges, for the shown rows only.
      const links = await forwardLinksOf(driveId, shown.map((t) => t.documentId));
      const involved = new Map<string, { documentId: string; title: string | null }[]>();
      if (!("error" in links)) {
        const untitled = new Set<string>();
        for (const t of shown) {
          const notes = (links.get(t.documentId) ?? [])
            .filter((e) => e.linkType === "INVOLVES")
            .map((e) => ({ documentId: e.targetDocumentId, title: e.targetTitle }));
          for (const n of notes) if (!n.title) untitled.add(n.documentId);
          involved.set(t.documentId, notes);
        }
        if (untitled.size > 0) {
          const titles = await noteTitles(driveId, [...untitled], untitled.size);
          for (const notes of involved.values()) {
            for (const n of notes) n.title ??= titles.get(n.documentId) ?? null;
          }
        }
      }
      const { counts, rows } = shapeContradictions(tensions, involved, wanted);
      const listed = rows.slice(0, limit);
      return ok(
        { counts, total: rows.length, contradictions: listed },
        `${counts.OPEN} open, ${counts.RESOLVED} resolved, ${counts.DISSOLVED} dissolved contradiction${tensions.length === 1 ? "" : "s"}` +
          (want === "ALL" ? "" : `; listed ${listed.length} ${want.toLowerCase()}`),
      );
    }

    case "topic_maps": {
      const wantedMap = str(args, "map");
      const limit = int(args, "limit", LIMITS.mapNotes.default, LIMITS.mapNotes.max);
      const r = await gql<{ knowledgeGraphNodesByStatus: MocNode[] }>(
        graphEndpoint(),
        `query M($driveId: ID!) {
          knowledgeGraphNodesByStatus(driveId: $driveId, status: "MOC") { documentId title description noteType }
        }`,
        { driveId },
      );
      if ("error" in r) return fail(r.error);
      const mocs = r.data.knowledgeGraphNodesByStatus.slice(0, LIMITS.maps);
      if (mocs.length === 0) {
        return ok({ maps: [], hubs: 0, unattached: [], notesInMaps: 0 }, "this vault has no maps of content yet");
      }
      const edges = await forwardLinksOf(driveId, mocs.map((m) => m.documentId));
      if ("error" in edges) return fail(edges.error);
      const links = new Map<string, MocLinks>();
      for (const m of mocs) {
        const out = edges.get(m.documentId) ?? [];
        links.set(m.documentId, {
          children: out.filter((e) => e.linkType === "CHILD_MOC").map((e) => e.targetDocumentId),
          notes: out
            .filter((e) => e.linkType === "CORE_IDEA")
            .map((e) => ({ documentId: e.targetDocumentId, title: e.targetTitle })),
        });
      }
      const tree = buildTopicMap(mocs, links);
      const tiers = (t: string) => tree.maps.filter((m) => m.tier === t).length;
      if (!wantedMap) {
        // Descriptions help choose a map, but on a vault with hundreds of
        // them they would crowd out the conversation; opening one gives it.
        const maps =
          tree.maps.length <= LIMITS.mapDescriptions
            ? tree.maps
            : tree.maps.map((m) => ({ ...m, description: null }));
        return ok(
          {
            ...tree,
            maps,
            totalMaps: tree.maps.length,
            ...(maps !== tree.maps ? { note: "Descriptions left out for size; open a map for its own." } : {}),
          },
          `${tree.maps.length} maps of content — ${tiers("HUB")} hub, ${tiers("DOMAIN")} area${tiers("DOMAIN") === 1 ? "" : "s"}, ${tiers("TOPIC")} topic${tiers("TOPIC") === 1 ? "" : "s"} — holding ${tree.notesInMaps} notes` +
            (tree.unattached.length
              ? `; ${tree.unattached.length} not attached to ${tree.hubs ? "the hub" : "anything"}`
              : ""),
        );
      }
      const found = resolveMap(tree.maps, wantedMap);
      if ("error" in found) return fail(found.error);
      const map = found.map;
      const byId = new Map(tree.maps.map((m) => [m.documentId, m]));
      const path: { documentId: string; title: string }[] = [];
      const seen = new Set<string>();
      for (let p = map.parentId; p && !seen.has(p); p = byId.get(p)?.parentId ?? null) {
        seen.add(p);
        const parent = byId.get(p);
        if (parent) path.unshift({ documentId: parent.documentId, title: parent.title });
      }
      const held = links.get(map.documentId)?.notes ?? [];
      const listedNotes = held.slice(0, limit);
      // Titles the edges did not carry, then each note's kind, from the tree.
      const untitled = listedNotes.filter((n) => !n.title).map((n) => n.documentId);
      const [titles, members] = await Promise.all([
        noteTitles(driveId, untitled, untitled.length),
        driveMembers(driveId),
      ]);
      const notes = listedNotes.map((n) => ({
        documentId: n.documentId,
        title: n.title ?? titles.get(n.documentId) ?? members?.get(n.documentId)?.name ?? null,
        documentType: members?.get(n.documentId)?.documentType ?? null,
      }));
      const childMaps = (links.get(map.documentId)?.children ?? [])
        .map((id) => byId.get(id))
        .filter((m): m is NonNullable<typeof m> => m !== undefined)
        .map((m) => ({ documentId: m.documentId, title: m.title, documentType: m.documentType, tier: m.tier, notes: m.notes, notesBeneath: m.notesBeneath }));
      return ok(
        { map, path, childMaps, notes, notesTotal: held.length },
        `opened map "${map.title}" (${map.tier}): ${held.length} note${held.length === 1 ? "" : "s"}` +
          (childMaps.length ? `, ${childMaps.length} map${childMaps.length === 1 ? "" : "s"} beneath it` : "") +
          (listedNotes.length < held.length ? `; listed ${listedNotes.length}` : ""),
      );
    }

    case "read_notes": {
      const raw = Array.isArray(args.documentIds) ? args.documentIds : typeof args.documentIds === "string" ? [args.documentIds] : [];
      // The same unwrapping as one id: a [[documentId]] copied from prose is the id inside it.
      const ids = [
        ...new Set(
          raw
            .map((v) => str({ v }, "v"))
            .filter((v): v is string => v !== null),
        ),
      ];
      if (ids.length === 0) return fail("read_notes needs documentIds: a list of the notes to read");
      const wanted = ids.slice(0, LIMITS.readMany);
      const aliases = wanted
        .map(
          (_, i) =>
            `n${i}: knowledgeGraphNodeByDocumentId(driveId: $driveId, documentId: $d${i}) { ${NOTE_FIELDS} content author sourceOrigin createdAt updatedAt topics }`,
        )
        .join("\n");
      const vars = wanted.map((_, i) => `$d${i}: String!`).join(", ");
      const variables: Record<string, unknown> = { driveId };
      wanted.forEach((id, i) => {
        variables[`d${i}`] = id;
      });
      const r = await gql<Record<string, Record<string, unknown> | null>>(
        graphEndpoint(),
        `query RN($driveId: ID!, ${vars}) { ${aliases} }`,
        variables,
      );
      if ("error" in r) return fail(r.error);
      const notes: Record<string, unknown>[] = [];
      const missing: string[] = [];
      wanted.forEach((id, i) => {
        const node = r.data[`n${i}`];
        if (node) notes.push(node);
        else missing.push(id);
      });
      const left = ids.length - wanted.length;
      const titles = notes.map((n) => `"${typeof n.title === "string" ? (n.title.length > 60 ? `${n.title.slice(0, 57)}…` : n.title) : n.documentId as string}"`);
      return ok(
        {
          notes,
          ...(missing.length ? { missing } : {}),
          ...(left > 0 ? { notRead: ids.slice(LIMITS.readMany), note: `Only ${LIMITS.readMany} notes are read per call; call again for the rest.` } : {}),
        },
        `read ${notes.length} note${notes.length === 1 ? "" : "s"}: ${titles.join(", ")}` +
          (missing.length ? `; ${missing.length} not found` : "") +
          (left > 0 ? `; ${left} left for another call` : ""),
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
      // The whole body: a note is one claim with its argument, and the part a
      // cap cut off was the part the answer most often needed — the caveat.
      return ok(
        node,
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
      // The tree names what the graph cannot: a source at the end of a
      // DERIVED_FROM link is not a graph node, so the edge arrives without a
      // title — and a document without a title cannot be cited.
      const membersRead = driveMembers(driveId);
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
      const members = await membersRead;
      const named = (id: string, title: string | null) => ({
        title: title ?? members?.get(id)?.name ?? null,
        documentType: members?.get(id)?.documentType ?? null,
      });
      const outgoing = r.data.out.slice(0, LIMITS.links).map((e) => ({
        documentId: e.targetDocumentId,
        ...named(e.targetDocumentId, e.targetTitle),
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
        ...named(e.sourceDocumentId, titles[`n${i}`]?.title ?? null),
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
      // The graph's counts and the sources' are read together: each answers a
      // question the other cannot, and neither failing should hide the other.
      // `sources: false` skips the heavier read when only the notes matter.
      const wantSources = args.sources !== false && args.sources !== "false";
      const sourcesRead = wantSources
        ? sourceLibrary(driveId)
        : Promise.resolve({ error: "not asked for" } as const);
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
      const lib = await sourcesRead;
      const sources = "error" in lib ? null : summarizeSources(lib.library);
      const sourcesNote = !wantSources
        ? {}
        : "error" in lib
          ? { sourcesError: lib.error }
          : lib.more
            ? { sourcesNote: `The vault holds more than ${SOURCES_PAGE} sources; these counts cover the first ${SOURCES_PAGE}.` }
            : {};
      const sourcesLine = !wantSources
        ? "sources not counted"
        : sources
          ? `${sources.total} source${sources.total === 1 ? "" : "s"} in ${sources.folderCount} folder${sources.folderCount === 1 ? "" : "s"}`
          : "sources could not be counted";
      if ("error" in r) {
        if (!sources) return fail(`${r.error}; and the sources could not be read: ${"error" in lib ? lib.error : ""}`);
        return ok(
          { graphError: r.error, sources, ...sourcesNote },
          `the graph index did not answer (${r.error}); ${sourcesLine}`,
        );
      }
      const s = r.data.knowledgeGraphStats;
      return ok(
        { ...s, density: r.data.knowledgeGraphDensity, ...(wantSources ? { sources } : {}), ...sourcesNote },
        `vault: ${s.noteCount} notes, ${s.mocCount} maps, ${s.scopeCount} scope${s.scopeCount === 1 ? "" : "s"} of work, ${s.edgeCount} links, ${s.orphanCount} orphans, ${s.openTensionCount} open tension${s.openTensionCount === 1 ? "" : "s"}; ${sourcesLine}`,
      );
    }

    case "list_sources": {
      const lib = await sourceLibrary(driveId);
      if ("error" in lib) return fail(lib.error);
      const limit = int(args, "limit", LIMITS.sources.default, LIMITS.sources.max);
      const r = browseSources(lib.library, {
        folder: str(args, "folder"),
        recursive: bool(args, "recursive"),
        status: str(args, "status"),
        sourceType: str(args, "sourceType"),
        query: str(args, "query"),
        limit,
      });
      if (!r.ok) return fail(r.error);
      const where = r.folder.path ? `/sources/${r.folder.path}` : "/sources";
      const shown = r.sources.length < r.matched ? `${r.sources.length} of ${r.matched}` : `${r.matched}`;
      return ok(
        {
          folder: r.folder,
          breadcrumb: r.breadcrumb,
          subfolders: r.subfolders,
          sources: r.sources,
          matched: r.matched,
          totalBeneath: r.totalBeneath,
          ...(lib.more ? { note: `Only the first ${SOURCES_PAGE} sources of the vault were read.` } : {}),
        },
        `opened ${where}: ${r.subfolders.length} folder${r.subfolders.length === 1 ? "" : "s"}, ${shown} source${r.matched === 1 ? "" : "s"}` +
          (r.totalBeneath !== r.matched ? ` (${r.totalBeneath} beneath it in all)` : ""),
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
          hasNextPage: boolean;
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
            hasNextPage items { id name documentType }
          }
        }`,
        { type, limit: nameContains ? LIMITS.documents.max : limit },
      );
      if ("error" in r) return fail(r.error);
      // The reactor stopped reporting a total (dev.26, #3107): what it served
      // and whether more exist is all it says now.
      const { hasNextPage, items } = r.data.findDocuments;
      const held = `${items.length}${hasNextPage ? "+" : ""}`;
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
      // without it, what the reactor served (and whether it had more).
      const total = live ? inVault.length : items.length;
      const where = live ? " in the vault" : "";
      if (nameContains) {
        return ok(
          { total, scanned: inVault.length, matched: matching.length, more: hasNextPage, items: listed },
          `listed ${listed.length} of ${matching.length} ${type} whose title contains "${nameContains}" (scanned ${inVault.length}${where} of ${held} the reactor served)`,
        );
      }
      return ok(
        { total, more: hasNextPage, items: listed },
        `listed ${listed.length} of ${live ? total : held} ${type}${where}`,
      );
    }

    case "list_projects": {
      // Envelopes: every scope-of-work document contributes its projects[].
      const sc = await gql<{
        findDocuments: { items: { id: string; name: string | null }[] };
      }>(
        reactorEndpoint(),
        `query S($limit: Int) {
          findDocuments(search: { type: "powerhouse/scopeofwork" }, paging: { limit: $limit }) {
            items { id name }
          }
        }`,
        { limit: LIMITS.projects },
      );
      // Fail loudly. Swallowing this reported "listed 0 envelopes across 0
      // scopes" for a query that never ran, which the model cannot tell apart
      // from a vault that genuinely has no projects — so a reactor hiccup
      // became a confident "there are no projects here".
      if ("error" in sc) return fail(sc.error);
      const envelopeRows: Record<string, unknown>[] = [];
      let scopeCount = 0;
      {
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
            // One row is ONE PROJECT, so the project names the row. This used
            // to lead with the SCOPE's documentId and title, which meant ten
            // projects arrived carrying only two distinct titles — every
            // envelope of "Powerhouse Platform 2027" was labelled
            // "Powerhouse Platform 2027", and its real name sat a level down
            // in `envelope.title`. A model listing projects duly reported the
            // scope title as the project, then found the nested one and
            // emitted the same project twice, once suffixed "(envelope)".
            //
            // The scope keeps its {documentId, title} pair because the
            // citation harvester needs it to label a [[scopeId]] chip — but
            // nested under `scope`, where it reads as the container it is.
            // collectKnownDocuments recurses, so it still finds it.
            envelopeRows.push({
              project: env.title,
              code: env.code,
              status: env.scope?.status ?? "DRAFT",
              owner: env.projectOwner ? (agentName.get(env.projectOwner) ?? env.projectOwner) : null,
              // The marker for THIS project, not merely the scope holding it.
              cite: `[[${item.id}#${env.id}]]`,
              envelopeId: env.id,
              scope: {
                documentId: item.id,
                documentType: "powerhouse/scopeofwork",
                title: g.title || item.name || item.id,
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
                ? {
                    documentId: env.wbsRef,
                    documentType: "bai/wbs",
                    title: `Work breakdown for ${env.title}`,
                    // Anchored on the SCOPE, so the breakdown opens inside it
                    // — the view the scope's own outline rail shows. Citing
                    // the WBS document id alone opens the standalone editor
                    // and loses the scope around it.
                    cite: `[[${item.id}#wbs:${env.id}]]`,
                  }
                : null,
            });
          }
        }
      }
      // Narrowed after reading, so the summary can still say how many there are.
      const wantStatus = str(args, "status")?.toUpperCase() ?? null;
      if (wantStatus && !["DRAFT", "TODO", "IN_PROGRESS", "FINISHED", "CANCELED"].includes(wantStatus)) {
        return fail("status must be one of: DRAFT, TODO, IN_PROGRESS, FINISHED, CANCELED");
      }
      const allProjects = envelopeRows.length;
      if (wantStatus) {
        const kept = envelopeRows.filter((r) => r.status === wantStatus);
        envelopeRows.length = 0;
        envelopeRows.push(...kept);
      }
      // The count leads the summary because a model listing these dropped one
      // of ten and still wrote "all ten projects". Naming every code makes the
      // omission visible in the same line that states the total.
      const codes = envelopeRows
        .map((r) => (typeof r.code === "string" && r.code ? r.code : "?"))
        .join(", ");
      const many = envelopeRows.length > 1;
      return ok(
        {
          total: envelopeRows.length,
          projects: envelopeRows,
          scopes: scopeCount,
          ...(wantStatus ? { status: wantStatus, allProjects } : {}),
        },
        `listed ${envelopeRows.length} ${wantStatus ? `${wantStatus} ` : ""}project${many ? "s" : ""}${wantStatus ? ` of ${allProjects}` : ""} across ${scopeCount} scope${scopeCount === 1 ? "" : "s"}` +
          (codes ? ` — ${codes}` : "") +
          (many ? `. Answer with all ${envelopeRows.length}.` : ""),
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
          document(idOrSlug: $id) {
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
