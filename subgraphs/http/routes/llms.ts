import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { GraphQuery, HttpRouteDeps } from "../lib/deps.js";
import { renderLlmsFull, renderLlmsTxt } from "../lib/llms.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export type LlmsRouteDeps = HttpRouteDeps & {
  getQuery(driveId: string): GraphQuery;
};

export function createLlmsRoute(deps: LlmsRouteDeps, full: boolean) {
  return async function handleLlms(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const base = `${ctx.transport.baseUrl}/api/@powerhousedao/knowledge-note`;

      if (ctx.user) {
        await canonicalForRead(deps, drive, ctx);
      } else {
        const canonical = await deps.resolveCanonicalDocumentId(drive, ctx);
        if (!(await deps.authorization.canRead(canonical, undefined))) {
          throw new HttpError(
            401,
            "UNAUTHENTICATED",
            "Sign in to read this vault",
          );
        }
        if (full) {
          throw new HttpError(
            401,
            "UNAUTHENTICATED",
            "Sign in to read the full index",
          );
        }
      }

      const query = deps.getQuery(drive);
      if (!full) {
        const mocs = await query.nodesByStatus("MOC");
        return new Response(
          renderLlmsTxt(
            {
              title: "Knowledge Vault",
              mocs: mocs.map((moc) => ({
                tier: /\(([A-Z]+)\)/.exec(moc.noteType ?? "")?.[1] ?? "TOPIC",
                title: moc.title ?? moc.documentId,
                id: moc.documentId,
              })),
            },
            drive,
            base,
          ),
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...OK_CACHE,
            },
          },
        );
      }

      const includeDrafts = url.searchParams.get("includeDrafts") === "1";
      const [canonical, scopes, wbs] = await Promise.all([
        query.nodesByStatus("CANONICAL"),
        query.nodesByDocumentType("powerhouse/scopeofwork"),
        query.nodesByDocumentType("bai/wbs"),
      ]);
      let notes = canonical;
      if (includeDrafts) {
        // A vault whose notes never leave DRAFT would otherwise serve an index
        // with no knowledge in it. Opt-in: every non-archived note joins the
        // canonical set (deduplicated).
        const allNotes = await query.nodesByDocumentType("bai/knowledge-note");
        const seen = new Set(canonical.map((note) => note.documentId));
        notes = [
          ...canonical,
          ...allNotes.filter(
            (note) => note.status !== "ARCHIVED" && !seen.has(note.documentId),
          ),
        ];
      }
      const sections = [
        ...notes.map((note) => ({
          title: note.title ?? note.documentId,
          body: note.content ?? note.description ?? "",
        })),
        ...scopes.map((scope) => ({
          title: scope.title ?? scope.documentId,
          body: scope.content ?? "",
        })),
        ...wbs.map((work) => ({
          title: work.title ?? work.documentId,
          body: work.content ?? "",
        })),
      ];
      return new Response(renderLlmsFull({ sections }), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...OK_CACHE,
        },
      });
    } catch (error) {
      return jsonError(error);
    }
  };
}