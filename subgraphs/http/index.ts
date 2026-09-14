import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { getQuery } from "../knowledge-graph/helpers/db.js";
import { searchVault } from "../knowledge-graph/helpers/search.js";
import { buildHttpRouteDeps, buildStructureRouteDeps } from "./live-deps.js";
import { getResolvers } from "./resolvers.js";
import { createActionsRoute } from "./routes/actions.js";
import { createDrivesRoute } from "./routes/drives.js";
import { createBadgeRoute, createHealthRoute } from "./routes/health.js";
import { createLlmsRoute } from "./routes/llms.js";
import { createNotesRoute } from "./routes/notes.js";
import { createRelationshipRoute } from "./routes/relationships.js";
import { createNotesRoute as createNotesBatchRoute } from "./routes/create.js";
import { createIngestSourceRoute } from "./routes/sources.js";
import { registerStructureRoutes } from "./routes/structure.js";
import { createClaimRoute } from "./routes/tasks.js";
import { createSearchRoute } from "./routes/search.js";
import { schema } from "./schema.js";

export class HttpSubgraph extends BaseSubgraph {
  name = "http";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};

  async onSetup(): Promise<void> {
    try {
      const deps = buildHttpRouteDeps(this);
      this.http.get("ping", { auth: "renown" }, (_request, ctx) =>
        Response.json({
          ok: true,
          subgraph: "http",
          user: ctx.user?.address ?? null,
        }),
      );
      this.http.get("drives", { auth: "renown" }, createDrivesRoute(deps));
      this.http.get(
        "search",
        { auth: "renown" },
        createSearchRoute({
          ...deps,
          search: (driveId, query, mode, limit, includeArchived) =>
            searchVault(this, driveId, query, mode, limit, includeArchived),
        }),
      );
      const notesDeps = {
        ...deps,
        edges: async (driveId: string, documentId: string) => {
          const query = getQuery(this, driveId);
          const [out, incoming] = await Promise.all([
            query.forwardLinks(documentId),
            query.backlinks(documentId),
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
              title: null,
              reason: edge.reason,
              confidence: edge.confidence,
            })),
          ];
        },
      };
      this.http.get(
        "notes/:id.md",
        { auth: "renown" },
        createNotesRoute(notesDeps, true),
      );
      this.http.get("notes/:id", { auth: "renown" }, createNotesRoute(notesDeps));
      this.http.post(
        "actions",
        { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
        createActionsRoute(deps),
      );
      // A source is ingested from content alone; the route places it in
      // /sources itself. Body cap matches `actions` — source content is the
      // one payload that is routinely large.
      // Batch create. Distinct method from `GET notes/:id`, so route order
      // with the note reads does not matter.
      this.http.post(
        "notes",
        { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
        createNotesBatchRoute(deps),
      );
      this.http.post(
        "sources",
        { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
        createIngestSourceRoute(deps),
      );
      this.http.post(
        "relationships",
        { auth: "renown", body: "parsed" },
        createRelationshipRoute(deps, "POST"),
      );
      this.http.patch(
        "relationships",
        { auth: "renown", body: "parsed" },
        createRelationshipRoute(deps, "PATCH"),
      );
      this.http.delete(
        "relationships",
        { auth: "renown", body: "parsed" },
        createRelationshipRoute(deps, "DELETE"),
      );
      this.http.post(
        "tasks/:id/claim",
        { auth: "renown", body: "parsed" },
        createClaimRoute(deps),
      );
      registerStructureRoutes(this.http, buildStructureRouteDeps(this));
      const llmsDeps = {
        ...deps,
        getQuery: (driveId: string) => getQuery(this, driveId),
      };
      this.http.get(
        "llms.txt",
        { auth: "renown-optional" },
        createLlmsRoute(llmsDeps, false),
      );
      this.http.get(
        "llms-full.txt",
        { auth: "renown-optional" },
        createLlmsRoute(llmsDeps, true),
      );
      this.http.get("health.json", { auth: "renown" }, createHealthRoute(deps));
      this.http.get("badge.svg", { auth: "public" }, createBadgeRoute(deps));
    } catch (error) {
      // An UnroutableScope throws here; the GraphQL surface must survive it.
      console.warn(
        `[http] route registration skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onDisconnect(): Promise<void> {}
}
