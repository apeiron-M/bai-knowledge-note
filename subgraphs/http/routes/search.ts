import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

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
    mode: "SEMANTIC" | "HYBRID",
    limit: number,
    includeArchived: boolean,
  ): Promise<SearchHit[]>;
}

const MAX_LIMIT = 25;

function withoutContent(node: Record<string, unknown>): Record<string, unknown> {
  const { content: _content, ...rest } = node;
  return rest;
}

function renderMarkdown(query: string, hits: SearchHit[]): string {
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
  return lines.join("\n");
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
      const rawMode = (url.searchParams.get("mode") ?? "hybrid").toLowerCase();
      if (rawMode !== "hybrid" && rawMode !== "semantic") {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "mode must be hybrid or semantic",
        );
      }
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(url.searchParams.get("limit") ?? 6) || 6),
      );
      const includeContent = url.searchParams.get("content") === "1";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      await canonicalForRead(deps, drive, ctx);
      const hits = await deps.search(
        drive,
        q,
        rawMode === "semantic" ? "SEMANTIC" : "HYBRID",
        limit,
        includeArchived,
      );
      const shaped = hits.map((hit) => ({
        ...hit,
        node: includeContent ? hit.node : withoutContent(hit.node),
      }));
      if ((request.headers.get("accept") ?? "").includes("text/markdown")) {
        return new Response(renderMarkdown(q, shaped), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            ...OK_CACHE,
          },
        });
      }
      return Response.json(
        { query: q, mode: rawMode, hits: shaped },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}