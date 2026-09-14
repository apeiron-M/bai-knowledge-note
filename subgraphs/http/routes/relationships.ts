import type { RouteContext } from "@powerhousedao/shared/processors";
import { checkArticulation } from "../lib/articulation.js";
import { canonicalForWrite } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { rejectUnknownFields } from "../lib/validate.js";
import { executeWrite } from "../lib/write.js";

export interface RelationshipBody {
  source: string;
  target: string;
  type: string;
  reason?: string;
  confidence?: string;
}

export function createRelationshipRoute(
  deps: HttpRouteDeps,
  method: "POST" | "PATCH" | "DELETE",
) {
  const actionType =
    method === "POST"
      ? "ADD_RELATIONSHIP"
      : method === "PATCH"
        ? "UPDATE_RELATIONSHIP"
        : "REMOVE_RELATIONSHIP";
  return async function handleRelationship(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      let body: RelationshipBody;
      try {
        body = (await request.json()) as RelationshipBody;
      } catch {
        throw new HttpError(400, "BAD_REQUEST", "body must be JSON");
      }
      rejectUnknownFields(body as unknown as Record<string, unknown>, [
        "source",
        "target",
        "type",
        "reason",
        "confidence",
      ]);
      if (!body.source || !body.target || !body.type) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "source, target and type are required",
        );
      }
      if (method !== "DELETE") {
        const message = checkArticulation({
          type: body.type,
          reason: body.reason,
          confidence: body.confidence,
        });
        if (message) {
          throw new HttpError(400, "LINT_CONVENTION", message, [
            { path: "reason", rule: "ARTICULATION" },
          ]);
        }
      }
      const canonicalSource = await canonicalForWrite(deps, body.source, ctx);
      const canonicalTarget = await deps.resolveCanonicalDocumentId(
        body.target,
        ctx,
      );
      const doc = await deps.reactorClient.get(canonicalSource);
      const input: Record<string, unknown> = {
        sourceId: canonicalSource,
        targetId: canonicalTarget,
        relationshipType: body.type,
      };
      if (method !== "DELETE") {
        input.metadata = { reason: body.reason, confidence: body.confidence };
      }
      const result = await executeWrite(deps, {
        documentId: canonicalSource,
        document: doc,
        actions: [{ type: actionType, input }],
        ctx,
        wait: true,
        defaultScope: "document",
      });
      return Response.json(
        {
          revision: result.revision,
          operations: result.operations,
          readBack: result.readBack,
          jobId: result.jobId,
        },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}