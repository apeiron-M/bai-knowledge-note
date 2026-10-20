import type { RouteContext } from "@powerhousedao/shared/processors";
import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import { requireUser } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { jsonError, OK_CACHE } from "../lib/respond.js";

/** The drive app id a knowledge vault's drive document is stamped with. */
export const VAULT_DRIVE_APP = "knowledge-vault";

interface DriveHeader {
  id: string;
  name?: string;
  slug?: string;
  meta?: { preferredEditor?: string };
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
        const header = drive.header as DriveHeader;
        // Only vaults: the drive app stamps preferredEditor when it opens a
        // drive, so this is the reliable marker of a knowledge-vault drive.
        if (header.meta?.preferredEditor !== VAULT_DRIVE_APP) continue;
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
            drive.state as { global?: { nodes?: unknown[] } } | undefined
          )?.global?.nodes ?? [];
        drives.push({
          id: header.id,
          name: header.name ?? header.slug ?? header.id,
          slug: header.slug ?? null,
          nodes: nodes.length,
        });
      }
      return Response.json({ drives }, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}