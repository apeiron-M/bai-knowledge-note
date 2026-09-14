import type { RouteContext } from "@powerhousedao/shared/processors";
import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import { requireUser } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { jsonError, OK_CACHE } from "../lib/respond.js";

interface DriveNode {
  documentType?: string;
}

export function createDrivesRoute(deps: HttpRouteDeps) {
  return async function handleDrives(
    _request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const user = requireUser(ctx);
      const found = await deps.reactorClient.find(
        { type: "powerhouse/document-drive" },
        undefined,
        { cursor: "", limit: 100 },
      );
      const drives = [];
      for (const drive of found.results) {
        const header = drive.header as {
          id: string;
          name?: string;
          slug?: string;
        };
        if (
          !(await deps.authorization.canRead(
            header.id as CanonicalDocumentId,
            user.address,
          ))
        ) {
          continue;
        }
        const nodes =
          (
            drive.state as { global?: { nodes?: DriveNode[] } } | undefined
          )?.global?.nodes ?? [];
        drives.push({
          id: header.id,
          name: header.name ?? header.slug ?? header.id,
          slug: header.slug ?? null,
          vault: nodes.some(
            (node) => node.documentType === "bai/vault-config",
          ),
          nodes: nodes.length,
        });
      }
      return Response.json({ drives }, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}