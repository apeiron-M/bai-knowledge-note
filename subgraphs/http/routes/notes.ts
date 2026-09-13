import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { renderNoteMarkdown, type EdgeView } from "../lib/markdown.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export interface NotesRouteDeps extends HttpRouteDeps {
  edges(driveId: string, documentId: string): Promise<EdgeView[]>;
}

export function createNotesRoute(deps: NotesRouteDeps) {
  return async function handleNote(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const rawId = ctx.params.id ?? "";
      const wantsMarkdown = rawId.endsWith(".md");
      const id = wantsMarkdown ? rawId.slice(0, -3) : rawId;
      if (!id) throw new HttpError(400, "BAD_REQUEST", "id is required");
      const canonicalId = await canonicalForRead(deps, id, ctx);
      const doc = await deps.reactorClient.get(canonicalId);
      const header = doc.header as {
        id: string;
        documentType: string;
        name?: string;
      };
      const edges = await deps.edges(drive, canonicalId);
      if (wantsMarkdown) {
        const linkBase = `${ctx.transport.baseUrl}/api/@powerhousedao/knowledge-note`;
        return new Response(
          renderNoteMarkdown(
            {
              id: header.id,
              name: header.name ?? header.id,
              documentType: header.documentType,
              state: doc.state,
            },
            edges,
            linkBase,
            drive,
          ),
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
          id: header.id,
          name: header.name,
          documentType: header.documentType,
          state: doc.state,
          edges,
        },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}