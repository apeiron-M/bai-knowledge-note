import type { RouteContext } from "@powerhousedao/shared/processors";
import { loadSourceTimeline, type TimelineGraph, type TimelineSourceStore } from "../../knowledge-graph/helpers/source-timeline.js";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export interface TimelineRouteDeps extends HttpRouteDeps {
  getQuery(driveId: string): TimelineGraph;
  /** Where source rows read from documents are kept for the next load. */
  getStore?(driveId: string): TimelineSourceStore;
}

/**
 * `GET timeline?drive=<id or slug>` — the source timeline, the same JSON as
 * the `knowledgeGraphSourceTimeline` query: every addition with when it
 * arrived and what it became, and each note's and topic's arrival.
 */
export function createTimelineRoute(deps: TimelineRouteDeps) {
  return async function handleTimeline(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const drive = new URL(request.url).searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      // Every read goes to the canonical id, never the identifier as given.
      const id = await canonicalForRead(deps, drive, ctx);
      const timeline = await loadSourceTimeline(deps.reactorClient, deps.getQuery(id), id, { store: deps.getStore?.(id) });
      return Response.json(timeline, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}
