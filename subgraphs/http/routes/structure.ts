import type { IHttpScope, RouteContext } from "@powerhousedao/shared/processors";
import type { IAuthorizationService } from "@powerhousedao/reactor-api";
import {
  canonicalForManage,
  canonicalForRead,
  canonicalForWrite,
} from "../lib/authorize.js";
import type { GraphQuery, HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export type StructureKind =
  | "stats"
  | "density"
  | "topics"
  | "byTopic"
  | "orphans"
  | "triangles"
  | "bridges"
  | "graph.json"
  | "embeddings/missing"
  | "similar"
  | "links"
  | "backlinks"
  | "connections"
  | "activity"
  | "history"
  | "access-map"
  | "admin/reindex";

export type StructureRouteDeps = HttpRouteDeps & {
  getQuery(driveId: string): GraphQuery;
  similar(driveId: string, documentId: string, limit: number): Promise<unknown[]>;
  reindex(
    driveId: string,
  ): Promise<{ indexedNodes: number; indexedEdges: number; errors: string[] }>;
  accessMap(driveId: string): Promise<unknown>;
  authorization: HttpRouteDeps["authorization"] & {
    canManage: IAuthorizationService["canManage"];
  };
};

const MAX_TRIANGLES = 100;
const MAX_LIMIT = 50;

function bounded(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw ?? fallback) || fallback;
  return Math.min(max, Math.max(1, value));
}

export function createStructureRoute(
  deps: StructureRouteDeps,
  kind: StructureKind,
) {
  return async function handleStructure(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const id = ctx.params.id ?? "";
      const query = () => deps.getQuery(drive);

      switch (kind) {
        case "stats":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().stats(), { headers: OK_CACHE });
        case "density":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(
            { density: await query().density() },
            { headers: OK_CACHE },
          );
        case "topics":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().topicStats(), {
            headers: OK_CACHE,
          });
        case "byTopic":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().nodesByTopic(ctx.params.name ?? ""), {
            headers: OK_CACHE,
          });
        case "orphans":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().orphanNodes(), {
            headers: OK_CACHE,
          });
        case "triangles":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(
            await query().triangles(bounded(url.searchParams.get("limit"), 20, MAX_TRIANGLES)),
            { headers: OK_CACHE },
          );
        case "graph.json":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(
            { nodes: await query().allNodes(), edges: await query().allEdges() },
            { headers: OK_CACHE },
          );
        case "embeddings/missing":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().documentIdsWithoutEmbeddings(), {
            headers: OK_CACHE,
          });
        case "similar":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(
            await deps.similar(
              drive,
              id,
              bounded(url.searchParams.get("limit"), 10, MAX_LIMIT),
            ),
            { headers: OK_CACHE },
          );
        case "links":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().forwardLinks(id), {
            headers: OK_CACHE,
          });
        case "backlinks":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(await query().backlinks(id), {
            headers: OK_CACHE,
          });
        case "connections":
          await canonicalForRead(deps, drive, ctx);
          return Response.json(
            await query().connections(
              id,
              bounded(url.searchParams.get("depth"), 2, 4),
            ),
            { headers: OK_CACHE },
          );
        case "activity":
          await canonicalForWrite(deps, drive, ctx);
          return Response.json(
            await query().activity(
              bounded(url.searchParams.get("limit"), 50, 200),
              url.searchParams.get("since") ?? undefined,
            ),
            { headers: OK_CACHE },
          );
        case "history":
          await canonicalForWrite(deps, drive, ctx);
          return Response.json(await query().history(id, MAX_LIMIT), {
            headers: OK_CACHE,
          });
        case "bridges":
          // Write, like `activity` and `history`. Not `canManage`: the old
          // gate was a cost guard from when the analysis re-ran a full
          // component count per node, and Tarjan retired that reason. Not
          // `canRead` either — bridges answers "what structural work needs
          // doing", and only someone who can write can act on it. Gating it
          // with the curation tools keeps the privilege matched to the use.
          await canonicalForWrite(deps, drive, ctx);
          return Response.json(await query().bridges(), { headers: OK_CACHE });
        case "access-map":
          await canonicalForManage(deps, drive, ctx);
          return Response.json(await deps.accessMap(drive), {
            headers: OK_CACHE,
          });
        case "admin/reindex":
          await canonicalForManage(deps, drive, ctx);
          return Response.json(await deps.reindex(drive), {
            headers: OK_CACHE,
          });
        default:
          throw new HttpError(500, "INTERNAL", `Unknown structure kind`);
      }
    } catch (error) {
      return jsonError(error);
    }
  };
}

export function registerStructureRoutes(
  http: IHttpScope,
  deps: StructureRouteDeps,
): void {
  const renown = { auth: "renown" as const };
  const route = (kind: StructureKind) => createStructureRoute(deps, kind);
  http.get("stats", renown, route("stats"));
  http.get("density", renown, route("density"));
  http.get("topics", renown, route("topics"));
  http.get("topics/:name", renown, route("byTopic"));
  http.get("orphans", renown, route("orphans"));
  http.get("triangles", renown, route("triangles"));
  http.get("bridges", renown, route("bridges"));
  http.get("graph.json", renown, route("graph.json"));
  http.get("embeddings/missing", renown, route("embeddings/missing"));
  http.get("notes/:id/similar", renown, route("similar"));
  http.get("notes/:id/links", renown, route("links"));
  http.get("notes/:id/backlinks", renown, route("backlinks"));
  http.get("notes/:id/connections", renown, route("connections"));
  http.get("activity", renown, route("activity"));
  http.get("notes/:id/history", renown, route("history"));
  http.get("access-map", renown, route("access-map"));
  http.post("admin/reindex", { auth: "renown", body: "parsed" }, route("admin/reindex"));
}