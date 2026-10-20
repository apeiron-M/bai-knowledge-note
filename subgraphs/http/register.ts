/**
 * The package's REST routes (`<origin>/api/@powerhousedao/knowledge-note/*`),
 * registered on any HTTP scope. The Switchboard registers them from
 * `HttpSubgraph.onSetup`; the browser vault (browser/rest.ts) registers the same
 * routes on a scope it serves inside the page. Everything a route needs comes
 * from `subgraph`: its reactor client, relational database, id resolution and
 * authorization.
 */
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { IHttpScope } from "@powerhousedao/shared/processors";
import { currentUser } from "./lib/authorize.js";
import { getQuery, getWritableDb } from "../knowledge-graph/helpers/db.js";
import { sourceRowStore } from "../knowledge-graph/helpers/source-timeline.js";
import { searchVault } from "../knowledge-graph/helpers/search.js";
import { buildNeighbourhood } from "../knowledge-graph/helpers/neighbourhood.js";
import { buildHttpRouteDeps, buildStructureRouteDeps } from "./live-deps.js";
import { createActionsRoute } from "./routes/actions.js";
import { createDrivesRoute } from "./routes/drives.js";
import { createBadgeRoute, createHealthRoute } from "./routes/health.js";
import { createLlmsRoute } from "./routes/llms.js";
import { createNotesRoute } from "./routes/notes.js";
import { createRelationshipRoute } from "./routes/relationships.js";
import { createNotesRoute as createNotesBatchRoute } from "./routes/create.js";
import { createHubRoute } from "./routes/hub.js";
import { createIngestSourceRoute } from "./routes/sources.js";
import { createIngestSourcesBatchRoute } from "./routes/sources-batch.js";
import { createSourceFolderRoute } from "./routes/source-folders.js";
import { registerStructureRoutes } from "./routes/structure.js";
import { createClaimRoute } from "./routes/tasks.js";
import { createReconcileRoute } from "./routes/reconcile.js";
import { createTimelineRoute } from "./routes/timeline.js";
import { createSearchRoute } from "./routes/search.js";
import { timedRoute } from "./lib/slow.js";

export function registerHttpRoutes(http: IHttpScope, subgraph: BaseSubgraph): void {
  const deps = buildHttpRouteDeps(subgraph);
  http.get("ping", { auth: "renown" }, timedRoute("GET ping", (_request, ctx) =>
    Response.json({
      ok: true,
      subgraph: "http",
      user: currentUser(ctx)?.address ?? null,
    }),
  ));
  http.get("drives", { auth: "renown" }, createDrivesRoute(deps));
  http.get(
    "search",
    { auth: "renown" },
    createSearchRoute({
      ...deps,
      search: (driveId, query, mode, limit, includeArchived) =>
        searchVault(subgraph, driveId, query, mode, limit, includeArchived),
      neighbourhood: (driveId, hits, options) =>
        buildNeighbourhood(
          getQuery(subgraph, driveId),
          hits.map((hit) => ({
            documentId: String(hit.node.documentId),
            similarity: hit.similarity,
            node: hit.node,
          })),
          options,
        ),
    }),
  );
  const notesDeps = {
    ...deps,
    edges: async (driveId: string, documentId: string) => {
      const query = getQuery(subgraph, driveId);
      const [out, incoming] = await Promise.all([
        query.forwardLinks(documentId),
        query.backlinks(documentId),
      ]);
      // The index denormalises only `target_title`, so an incoming edge
      // carries no name for the note at the far end. Without this, a
      // reader following backlinks to strengthen an answer learns what a
      // note points TO but never what points AT it — which is where MoC
      // membership and the notes building on it live. One batched lookup.
      const sources = await query.nodesByDocumentIds([
        ...new Set(incoming.map((edge) => edge.sourceDocumentId)),
      ]);
      return [
        ...out.map((edge) => ({
          direction: "out" as const,
          documentId: edge.targetDocumentId,
          linkType: edge.linkType ?? "",
          title: edge.targetTitle,
          reason: edge.reason,
          confidence: edge.confidence,
        })),
        ...incoming.map((edge) => ({
          direction: "in" as const,
          documentId: edge.sourceDocumentId,
          linkType: edge.linkType ?? "",
          title: sources.get(edge.sourceDocumentId)?.title ?? null,
          reason: edge.reason,
          confidence: edge.confidence,
        })),
      ];
    },
  };
  http.get(
    "notes/:id.md",
    { auth: "renown" },
    createNotesRoute(notesDeps, true),
  );
  http.get("notes/:id", { auth: "renown" }, createNotesRoute(notesDeps));
  http.post(
    "actions",
    { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
    timedRoute("POST actions", createActionsRoute(deps)),
  );
  // A source is ingested from content alone; the route places it in
  // /sources itself. Body cap matches `actions` — source content is the
  // one payload that is routinely large.
  // Batch create. Distinct method from `GET notes/:id`, so route order
  // with the note reads does not matter.
  http.post(
    "notes",
    { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
    timedRoute("POST notes", createNotesBatchRoute(deps)),
  );
  // Registered BEFORE `sources` so the more specific path matches first:
  // routes match in registration order.
  http.post(
    "sources/folders",
    { auth: "renown", body: "parsed" },
    timedRoute("POST sources/folders", createSourceFolderRoute(deps)),
  );
  // Many sources in one request: the drive and the queue are read and
  // written once per batch rather than once per source. Registered before
  // `sources`, like `sources/folders`. Up to 50 sources' content.
  http.post(
    "sources/batch",
    { auth: "renown", body: "parsed", maxBodyBytes: 8 * 1024 * 1024 },
    timedRoute("POST sources/batch", createIngestSourcesBatchRoute(deps)),
  );
  http.post(
    "sources",
    { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
    timedRoute("POST sources", createIngestSourceRoute(deps)),
  );
  http.post(
    "relationships",
    { auth: "renown", body: "parsed" },
    timedRoute("POST relationships", createRelationshipRoute(deps, "POST")),
  );
  http.patch(
    "relationships",
    { auth: "renown", body: "parsed" },
    timedRoute("PATCH relationships", createRelationshipRoute(deps, "PATCH")),
  );
  http.delete(
    "relationships",
    { auth: "renown", body: "parsed" },
    timedRoute("DELETE relationships", createRelationshipRoute(deps, "DELETE")),
  );
  // The vault's one HUB: created if missing, duplicates merged — under a per-vault lock (routes/hub.ts).
  http.post("hub", { auth: "renown", body: "parsed" }, timedRoute("POST hub", createHubRoute(deps)));
  // The queue caught up with what the vault already holds (lib/reconcile.ts).
  http.post(
    "tasks/reconcile",
    { auth: "renown", body: "parsed" },
    timedRoute(
      "POST tasks/reconcile",
      createReconcileRoute({ ...deps, graph: (driveId: string) => getQuery(subgraph, driveId) }),
    ),
  );
  http.post(
    "tasks/:id/claim",
    { auth: "renown", body: "parsed" },
    timedRoute("POST tasks/:id/claim", createClaimRoute(deps)),
  );
  registerStructureRoutes(http, buildStructureRouteDeps(subgraph));
  http.get(
    "timeline",
    { auth: "renown" },
    timedRoute(
      "GET timeline",
      createTimelineRoute({
        ...deps,
        getQuery: (driveId: string) => getQuery(subgraph, driveId),
        getStore: (driveId: string) => sourceRowStore(() => getWritableDb(subgraph, driveId)),
      }),
    ),
  );
  const llmsDeps = {
    ...deps,
    getQuery: (driveId: string) => getQuery(subgraph, driveId),
  };
  http.get(
    "llms.txt",
    { auth: "renown-optional" },
    createLlmsRoute(llmsDeps, false),
  );
  http.get(
    "llms-full.txt",
    { auth: "renown-optional" },
    createLlmsRoute(llmsDeps, true),
  );
  http.get("health.json", { auth: "renown" }, createHealthRoute(deps));
  http.get("badge.svg", { auth: "public" }, createBadgeRoute(deps));
}
