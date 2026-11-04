import type { RouteContext } from "@powerhousedao/shared/processors";
import type { ChangeDigest } from "../../../processors/graph-indexer/changes.js";
import { renderChangesMarkdown } from "../../../processors/graph-indexer/changes-markdown.js";
import { ChangeWindowError, type ChangeArgs } from "../../knowledge-graph/helpers/changes-scope.js";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export interface ChangesRouteDeps extends HttpRouteDeps {
  /** The digest for a canonical drive id — `loadDriveChanges`, shared with knowledgeGraphChanges. */
  loadChanges(driveId: string, args: ChangeArgs): Promise<ChangeDigest>;
}

function list(raw: string | null): string[] | undefined {
  const items = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

/**
 * `GET changes?drive=&since=&until=&moc=&topic=&q=&documentIds=&types=&limit=&cursor=`
 * — what changed in the drive over a window: the same digest as the
 * `knowledgeGraphChanges` query (one code path, so the same totals), as JSON,
 * or as a readable report with `Accept: text/markdown`. Read-gated at the
 * drive. `documentIds` and `types` are comma-separated.
 */
export function createChangesRoute(deps: ChangesRouteDeps) {
  return async function handleChanges(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const params = new URL(request.url).searchParams;
      const drive = params.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const since = params.get("since");
      if (!since) throw new HttpError(400, "BAD_REQUEST", "since is required (an ISO date, UTC)");
      const id = await canonicalForRead(deps, drive, ctx);
      const limit = params.get("limit");
      const args: ChangeArgs = {
        since,
        until: params.get("until"),
        moc: params.get("moc"),
        topic: params.get("topic"),
        q: params.get("q"),
        documentIds: list(params.get("documentIds")),
        types: list(params.get("types")),
        limit: limit && Number.isFinite(Number(limit)) ? Number(limit) : undefined,
        cursor: params.get("cursor"),
      };
      let digest: ChangeDigest;
      try {
        digest = await deps.loadChanges(id, args);
      } catch (err) {
        if (err instanceof ChangeWindowError) throw new HttpError(400, "BAD_REQUEST", err.message);
        throw err;
      }
      if ((request.headers.get("accept") ?? "").includes("text/markdown")) {
        return new Response(renderChangesMarkdown(digest), {
          headers: { ...OK_CACHE, "Content-Type": "text/markdown; charset=utf-8" },
        });
      }
      return Response.json(digest, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}
