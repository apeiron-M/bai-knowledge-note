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
import { authHeaders } from "../../../shared/authed-fetch.js";
import {
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
} from "../../../shared/subgraph-endpoint.js";
import { fetchDocumentState } from "../../../shared/document-state.js";
import type { WorkBreakdownStructureState } from "document-models/work-breakdown-structure";
import type { ToolSchema } from "./completions-client.js";
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

const wbsState = (state: Record<string, unknown>) =>
  (state.global ?? {}) as WorkBreakdownStructureState;
const scopeState = (state: Record<string, unknown>) =>
  (state.global ?? {}) as ScopeOfWorkState;
/** Envelopes stored before knowledgeRefs existed have no array at all. */
const envelopeRefs = (env: { knowledgeRefs: string[] }): string[] =>
  (env as { knowledgeRefs?: string[] }).knowledgeRefs ?? [];

/* ------------------------------------------------------------------ */
/*  Argument helpers                                                  */
/* ------------------------------------------------------------------ */

function bool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  return v === true || v === "true";
}

function str(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { driveId } = ctx;

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
      const matching = nameContains
        ? items.filter((d) => (d.name ?? "").toLowerCase().includes(nameContains))
        : items;
      // Same citation contract as every other tool: documentId + title (+
      // documentType), so [[documentId]] works for a source or a tension
      // exactly as it does for a note.
      const listed = matching.slice(0, limit).map((d) => ({
        documentId: d.id,
        title: d.name ?? d.id,
        documentType: d.documentType ?? type,
      }));
      if (nameContains) {
        return ok(
          { total: totalCount, scanned: items.length, matched: matching.length, items: listed },
          `listed ${listed.length} of ${matching.length} ${type} whose title contains "${nameContains}" (scanned ${items.length} of ${totalCount})`,
        );
      }
      return ok(
        { total: totalCount, items: listed },
        `listed ${listed.length} of ${totalCount} ${type}`,
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
        scopeCount = sc.data.findDocuments.totalCount;
        for (const item of sc.data.findDocuments.items) {
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

    case "read_document": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("read_document needs a documentId");
      const offset = nonNegativeInt(args, "offset");
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
