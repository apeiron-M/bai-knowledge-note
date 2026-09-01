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
import type { ToolSchema } from "./openrouter-client.js";

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
  "bai/project",
  "bai/wbs",
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
  noteContent: 6000,
  documentWindow: 8000,
  metaString: 300,
  metaArray: 20,
} as const;

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const NOTE_FIELDS = "documentId title description noteType status";

export const VAULT_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "search_vault",
      description:
        "Default entry point. Semantic + keyword search over the vault's knowledge notes and maps of content. Pass the user's question or a short phrase as-is. Returns ranked hits with a 0–1 similarity; use read_note on the promising ones for their full text. Does NOT search sources — use list_documents for those.",
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
        "Explicit graph links of a note in both directions: what it links to (outgoing) and what links to it (incoming), each with the link type (RELATES_TO, BUILDS_ON, CONTRADICTS, SUPERSEDES, DERIVED_FROM, CORE_IDEA, CHILD_MOC). Use to follow an argument, find contradictions, or see which map of content owns a note.",
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
      description: `List documents of one type with their ids and names. The graph tools only cover knowledge notes and maps of content; everything else — especially bai/source, the long-form material notes were extracted from — is reached through this tool and then read_document. Valid types: ${DOCUMENT_TYPES.join(", ")}.`,
      parameters: {
        type: "object",
        properties: {
          documentType: { type: "string", enum: [...DOCUMENT_TYPES] },
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
      name: "read_document",
      description:
        "Read any document by id, paged. Returns its metadata plus an 8,000-character window of its main text starting at offset; when hasMore is true, call again with nextOffset to continue. For a bai/source the metadata includes extractedClaims — the ids of notes derived from it — which you can then read_note. Note the reverse is not available: a note does not record which source it came from.",
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

/* ------------------------------------------------------------------ */
/*  Argument helpers                                                  */
/* ------------------------------------------------------------------ */

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
      const r = await gql<{
        knowledgeGraphSemanticSearch: {
          similarity: number;
          matchedBy: string[];
          node: Record<string, unknown>;
        }[];
      }>(
        graphEndpoint(),
        `query S($driveId: ID!, $query: String!, $limit: Int) {
          knowledgeGraphSemanticSearch(driveId: $driveId, query: $query, mode: HYBRID, limit: $limit) {
            similarity matchedBy node { ${NOTE_FIELDS} }
          }
        }`,
        { driveId, query, limit },
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
        `query B($driveId: ID!, $topic: String!) {
          knowledgeGraphByTopic(driveId: $driveId, topic: $topic) { ${NOTE_FIELDS} }
        }`,
        { driveId, topic },
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
        `query R($driveId: ID!, $documentId: String!, $limit: Int) {
          knowledgeGraphSimilar(driveId: $driveId, documentId: $documentId, limit: $limit) {
            similarity node { ${NOTE_FIELDS} }
          }
        }`,
        { driveId, documentId, limit },
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
        }[];
        inc: { sourceDocumentId: string; linkType: string | null }[];
      }>(
        graphEndpoint(),
        `query L($driveId: ID!, $documentId: String!) {
          out: knowledgeGraphForwardLinks(driveId: $driveId, documentId: $documentId) { targetDocumentId linkType targetTitle }
          inc: knowledgeGraphBacklinks(driveId: $driveId, documentId: $documentId) { sourceDocumentId linkType }
        }`,
        { driveId, documentId },
      );
      if ("error" in r) return fail(r.error);
      const outgoing = r.data.out.slice(0, LIMITS.links).map((e) => ({
        documentId: e.targetDocumentId,
        title: e.targetTitle,
        linkType: e.linkType,
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
          edgeCount: number;
          orphanCount: number;
        };
        knowledgeGraphDensity: number;
      }>(
        graphEndpoint(),
        `query V($driveId: ID!) {
          knowledgeGraphStats(driveId: $driveId) { nodeCount edgeCount orphanCount }
          knowledgeGraphDensity(driveId: $driveId)
        }`,
        { driveId },
      );
      if ("error" in r) return fail(r.error);
      const s = r.data.knowledgeGraphStats;
      return ok(
        { ...s, density: r.data.knowledgeGraphDensity },
        `vault: ${s.nodeCount} notes, ${s.edgeCount} links, ${s.orphanCount} orphans`,
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
        { type, limit },
      );
      if ("error" in r) return fail(r.error);
      const { totalCount, items } = r.data.findDocuments;
      return ok(
        { total: totalCount, items },
        `listed ${items.length} of ${totalCount} ${type}`,
      );
    }

    case "read_document": {
      const documentId = str(args, "documentId");
      if (!documentId) return fail("read_document needs a documentId");
      const offset = nonNegativeInt(args, "offset");
      let doc: Awaited<ReturnType<typeof fetchDocumentState>>;
      try {
        doc = await fetchDocumentState(documentId);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      if (!doc) return fail(`no document with id ${documentId}`);

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

      return ok(
        {
          id: doc.id,
          name: doc.name,
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
