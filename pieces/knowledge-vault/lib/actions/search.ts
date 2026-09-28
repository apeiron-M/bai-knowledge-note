import { createAction, Property } from "@powerhousedao/pieces-framework";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { driveProp } from "../common/props.js";

type SearchNode = {
  documentId?: string;
  documentType?: string;
  title?: string | null;
  description?: string | null;
  content?: string | null;
  noteType?: string | null;
  status?: string | null;
};
type SearchResponse = {
  query: string;
  hits: { node: SearchNode; similarity: number; matchedBy?: string }[];
  related?: unknown[];
  links?: unknown[];
};

export type SearchHit = {
  id: string;
  title: string;
  description: string | null;
  similarity: number;
  document_type: string | null;
  note_type: string | null;
  status: string | null;
  content?: string | null;
};

/** Flat, named fields: an expression can pick `first_id` but cannot index an array with `[0]`. */
export function shapeSearch(response: SearchResponse, minSimilarity: number, excludeMocs: boolean) {
  const hits: SearchHit[] = response.hits
    .filter((hit) => hit.similarity >= minSimilarity)
    .filter((hit) => !excludeMocs || hit.node.status !== "MOC")
    .map(({ node, similarity }) => ({
      id: String(node.documentId ?? ""),
      title: node.title ?? String(node.documentId ?? ""),
      description: node.description ?? null,
      similarity: Math.round(similarity * 1000) / 1000,
      document_type: node.documentType ?? null,
      note_type: node.noteType ?? null,
      status: node.status ?? null,
      ...(node.content !== undefined ? { content: node.content } : {}),
    }));
  return {
    query: response.query,
    count: hits.length,
    first_id: hits[0]?.id ?? null,
    first_title: hits[0]?.title ?? null,
    hits,
    related: response.related ?? [],
    links: response.links ?? [],
  };
}

export const searchAction = createAction({
  auth: knowledgeVaultAuth,
  name: "search",
  displayName: "Search the vault",
  description:
    "Semantic search over the vault's notes and MoCs: ranks by meaning, with the neighbourhood of the best hits. Use it to give an LLM step context, or to branch on whether something is already known.",
  audience: "both",
  aiMetadata: { idempotent: true },
  props: {
    drive: driveProp,
    query: Property.LongText({
      displayName: "Query",
      description: "A question or topic in plain language",
      required: true,
    }),
    limit: Property.Number({
      displayName: "Results",
      description: "How many hits, 1–25 (default 6)",
      required: false,
      defaultValue: 6,
    }),
    related: Property.Number({
      displayName: "Related notes",
      description: "Neighbours of the top hits to include, 0–50 (default 10; 0 turns it off)",
      required: false,
      defaultValue: 10,
    }),
    include_content: Property.Checkbox({
      displayName: "Include full content",
      description: "Return each hit's full text, not only its title and description",
      required: false,
      defaultValue: false,
    }),
    include_archived: Property.Checkbox({
      displayName: "Include archived notes",
      required: false,
      defaultValue: false,
    }),
    min_similarity: Property.Number({
      displayName: "Minimum similarity",
      description: "Drop hits below this cosine similarity, 0–1 (0 keeps everything; 0.8 is a strong match)",
      required: false,
      defaultValue: 0,
    }),
    exclude_mocs: Property.Checkbox({
      displayName: "Notes only",
      description: "Leave Maps of Content out of the hits",
      required: false,
      defaultValue: false,
    }),
    as_markdown: Property.Checkbox({
      displayName: "Markdown digest",
      description: "Also return the results as one markdown document, ready to paste into a prompt",
      required: false,
      defaultValue: false,
    }),
  },
  outputSchema: {
    fields: [
      { key: "count", label: "Number of hits" },
      { key: "first_id", label: "Best hit: document id" },
      { key: "first_title", label: "Best hit: title" },
      { key: "hits", label: "Hits (id, title, description, similarity, document_type, note_type, status)" },
      { key: "related", label: "Related notes" },
      { key: "links", label: "Links between hits and related notes" },
      { key: "markdown", label: "Markdown digest (when requested)" },
    ],
  },
  async run(context) {
    const p = context.propsValue;
    const client = clientForContext(context);
    const query = {
      drive: p.drive,
      q: p.query,
      mode: "semantic",
      limit: clamp(p.limit, 1, 25, 6),
      related: clamp(p.related, 0, 50, 10),
      content: p.include_content ? 1 : undefined,
      includeArchived: p.include_archived ? 1 : undefined,
    };
    const response = await client.request<SearchResponse>({ path: "search", query });
    const shaped = shapeSearch(response, clamp(p.min_similarity, 0, 1, 0), p.exclude_mocs === true);
    if (!p.as_markdown) return shaped;
    const markdown = await client.request<string>({ path: "search", query, accept: "text/markdown" });
    return { ...shaped, markdown };
  },
});

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
