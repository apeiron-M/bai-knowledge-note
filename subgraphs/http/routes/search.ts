import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import type {
  Neighbourhood,
  NeighbourVia,
} from "../../knowledge-graph/helpers/neighbourhood.js";

export interface SearchHit {
  node: Record<string, unknown>;
  similarity: number;
  score: number;
  matchedBy: string[];
}

export interface SearchRouteDeps extends HttpRouteDeps {
  search(
    driveId: string,
    query: string,
    mode: "SEMANTIC",
    limit: number,
    includeArchived: boolean,
  ): Promise<SearchHit[]>;
  /**
   * One-hop graph expansion of the hits. Separate from `search` so the
   * ranking path stays independent of the graph read, and so a failure here
   * can degrade to plain results rather than a failed search.
   */
  neighbourhood(
    driveId: string,
    hits: SearchHit[],
    options: { limit: number; includeArchived: boolean },
  ): Promise<Neighbourhood>;
}

const MAX_LIMIT = 25;
const DEFAULT_RELATED = 10;
const MAX_RELATED = 50;

function withoutContent(node: Record<string, unknown>): Record<string, unknown> {
  const { content: _content, ...rest } = node;
  return rest;
}

/** Link types that change whether an answer is correct, not just how full it is. */
const CONTESTING = new Set(["CONTRADICTS", "SUPERSEDES"]);

function renderVia(via: NeighbourVia, subjectId: string): string {
  // Spelled out rather than left to an arrow: "BUILDS_ON *X*" is ambiguous
  // about which side builds on which, and that ambiguity is the whole content
  // of the edge. Named subject, named object, no direction to infer.
  const outgoing = via.from === subjectId;
  const otherTitle = (outgoing ? via.toTitle : via.fromTitle) ?? "(untitled)";
  const type = via.linkType ?? "LINK";
  const clause = outgoing
    ? `this note ${type} *${otherTitle}*`
    : `*${otherTitle}* ${type} this note`;
  const reason = via.reason ? ` — ${via.reason}` : "";
  return `  ${outgoing ? "→" : "←"} ${clause}${reason}`;
}

function renderMarkdown(
  query: string,
  hits: SearchHit[],
  graph: Neighbourhood,
  shown: number,
): string {
  const lines = [`# Search: ${query}`, ""];
  hits.forEach((hit, i) => {
    const node = hit.node as {
      documentId?: string;
      title?: string;
      description?: string;
      content?: string;
    };
    lines.push(
      `${i + 1}. [${node.title ?? node.documentId}](${node.documentId}) — ${(hit.similarity * 100).toFixed(0)}% (${hit.matchedBy.join("+")})`,
    );
    if (node.description) lines.push(`   ${node.description}`);
    if (node.content) lines.push("", node.content, "");
  });

  if (graph.links.length) {
    lines.push("", "## How these results connect to each other", "");
    for (const via of graph.links) {
      lines.push(
        `- *${via.fromTitle ?? via.from}* ${via.linkType ?? "LINK"} *${via.toTitle ?? via.to}*${via.reason ? ` — ${via.reason}` : ""}`,
      );
    }
  }

  if (graph.related.length) {
    lines.push(
      "",
      `## Related notes (${shown} of ${graph.totalRelated} connected to the results above)`,
      "",
      "These are one link away from the results and were NOT returned as hits.",
      "Read any of them with `GET notes/{id}` (add `?format=md` for markdown).",
    );
    // A contradicted or superseded result is the one case where ignoring the
    // neighbourhood produces a WRONG answer rather than a thin one, so it is
    // called out where a reader skimming the section cannot miss it.
    const contested = graph.related.filter((neighbour) =>
      neighbour.via.some((via) => CONTESTING.has(via.linkType ?? "")),
    ).length;
    if (contested) {
      lines.push(
        "",
        `**Caution: ${contested} of these contradict or supersede a result above. Read them before answering.**`,
      );
    }
    lines.push("");
    for (const neighbour of graph.related) {
      const kind = neighbour.noteType ? ` _(${neighbour.noteType})_` : "";
      lines.push(
        `- **${neighbour.title ?? "(untitled)"}**${kind} \`${neighbour.documentId}\``,
      );
      if (neighbour.description) lines.push(`  ${neighbour.description}`);
      for (const via of neighbour.via) {
        lines.push(renderVia(via, neighbour.documentId));
      }
    }
    if (graph.truncated) {
      lines.push(
        "",
        `_${graph.totalRelated - shown} further connected notes were omitted. Raise \`related\` (max ${MAX_RELATED}) to see more._`,
      );
    }
  }
  return lines.join("\n");
}

function intParam(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

export function createSearchRoute(deps: SearchRouteDeps) {
  return async function handleSearch(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      const q = url.searchParams.get("q");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      if (!q) throw new HttpError(400, "BAD_REQUEST", "q is required");
      // `mode` is accepted for compatibility but only `semantic` exists.
      // Hybrid was removed: its keyword leg ANDs its terms, so a question
      // matched nothing there, and it then rescaled a genuine 0.97 match down
      // to ~0.5 — which made `similarity` unusable as a threshold.
      const rawMode = (url.searchParams.get("mode") ?? "semantic").toLowerCase();
      if (rawMode !== "semantic") {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `mode must be semantic (got "${rawMode}"); hybrid was removed`,
        );
      }
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(url.searchParams.get("limit") ?? 6) || 6),
      );
      const includeContent = url.searchParams.get("content") === "1";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      // Expansion is ON by default: a caller that only knows how to search
      // still gets told what the results connect to. `related=0` opts out.
      const relatedLimit = intParam(
        url.searchParams.get("related"),
        DEFAULT_RELATED,
        MAX_RELATED,
      );
      await canonicalForRead(deps, drive, ctx);
      const hits = await deps.search(
        drive,
        q,
        "SEMANTIC",
        limit,
        includeArchived,
      );
      let graph: Neighbourhood = {
        related: [],
        byHit: {},
        links: [],
        linksByHit: {},
        totalRelated: 0,
        truncated: false,
      };
      if (relatedLimit > 0 && hits.length > 0) {
        try {
          graph = await deps.neighbourhood(drive, hits, {
            limit: relatedLimit,
            includeArchived,
          });
        } catch (error) {
          // Expansion is additive. If the graph read fails the search still
          // answered the question, so degrade instead of 500-ing.
          console.warn(
            `[http] search expansion failed for drive ${drive}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const shaped = hits.map((hit) => ({
        ...hit,
        node: includeContent ? hit.node : withoutContent(hit.node),
      }));
      if ((request.headers.get("accept") ?? "").includes("text/markdown")) {
        return new Response(
          renderMarkdown(q, shaped, graph, graph.related.length),
          {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              ...OK_CACHE,
            },
          },
        );
      }
      return Response.json(
        {
          query: q,
          mode: rawMode,
          hits: shaped,
          related: graph.related,
          links: graph.links,
          expansion: {
            hops: 1,
            relatedTotal: graph.totalRelated,
            relatedShown: graph.related.length,
            truncated: graph.truncated,
          },
        },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}
