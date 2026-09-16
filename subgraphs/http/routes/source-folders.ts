import type { Action } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { stampActions } from "../lib/envelope.js";
import { HttpError, jsonError } from "../lib/respond.js";
import { rejectUnknownFields } from "../lib/validate.js";
import { folderPaths, resolveVaultFolder } from "../lib/vault-folders.js";

interface CreateFolderBody {
  drive?: string;
  name?: string;
}

interface DriveNode {
  id?: string;
  name?: string;
  kind?: string;
  documentType?: string;
  parentFolder?: string | null;
}

const SOURCE_TYPE = "bai/source";

const driveNodes = (drive: unknown): DriveNode[] =>
  ((drive as { state?: { global?: { nodes?: DriveNode[] } } })?.state?.global
    ?.nodes ?? []);

const isFolder = (node: DriveNode): boolean =>
  node.kind === "folder" || !node.documentType;

/**
 * `POST sources/folders` — group sources under `/sources`.
 *
 * Splitting one long source into many (a book into chapters) is the right
 * shape for the vault — every operation stores a full copy of the document's
 * state, so one enormous source makes every later write to it expensive — but
 * it scatters twenty loose sources that a reader has no way to see as one
 * thing. A folder puts that back, for navigation only: everything a query
 * needs still lives in each source's own fields.
 *
 * Creation is its own route, and returns an id, because `POST sources` takes a
 * folder ID rather than a name. A name would mean the server guessing which
 * folder was meant on every ingest, and racing twenty chapter ingests would
 * make several folders with the same name. One deliberate call mints the
 * folder; the chapters then all name the same id.
 *
 * Idempotent on name within `/sources`: re-running an ingest returns the
 * existing folder rather than a duplicate. A folder of the same name
 * elsewhere in the drive is a different folder and is ignored.
 */
export function createSourceFolderRoute(deps: HttpRouteDeps) {
  return async function handleCreateSourceFolder(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      let body: CreateFolderBody;
      try {
        body = (await request.json()) as CreateFolderBody;
      } catch {
        throw new HttpError(400, "BAD_REQUEST", "Body must be JSON");
      }
      rejectUnknownFields(body as Record<string, unknown>, ["drive", "name"]);
      if (!body.drive) {
        throw new HttpError(400, "BAD_REQUEST", "drive is required");
      }
      const name = body.name?.trim();
      if (!name) {
        throw new HttpError(400, "BAD_REQUEST", "name is required");
      }
      if (name.includes("/")) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "name is one folder, not a path: it cannot contain '/'",
          [{ path: "name" }],
        );
      }
      const driveId = await canonicalForWrite(deps, body.drive, ctx);

      // Throws FOLDER_UNRESOLVED when the drive was never scaffolded, which
      // is the same failure `POST sources` gives — one rule, one message.
      const sourcesId = await resolveVaultFolder(deps, driveId, SOURCE_TYPE);

      const existing = driveNodes(await deps.reactorClient.get(driveId)).find(
        (n) =>
          isFolder(n) && n.parentFolder === sourcesId && n.name === name,
      );
      if (existing?.id) {
        return Response.json(
          { id: existing.id, name, path: `/sources/${name}`, created: false },
          { status: 200 },
        );
      }

      const id = deps.uuid();
      const actions = stampActions(
        [{ type: "ADD_FOLDER", input: { id, name, parentFolder: sourcesId } }],
        () => deps.now(),
        () => deps.uuid(),
        "global",
      );
      const signal =
        ctx.signal && !ctx.signal.aborted ? ctx.signal : undefined;
      const job = await deps.reactorClient.executeAsync(
        driveId,
        "main",
        actions as unknown as Action[],
        signal,
      );
      const finished = await deps.reactorClient.waitForJob(job.id, signal);
      if (finished.error) {
        throw new HttpError(502, "CREATE_FAILED", finished.error.message);
      }

      // Read the drive back. A folder id that does not exist would place
      // every chapter nowhere, and the ingest would only fail later.
      const after = driveNodes(await deps.reactorClient.get(driveId));
      const placed = after.find((n) => n.id === id);
      if (!placed) {
        throw new HttpError(
          502,
          "FOLDER_NOT_PLACED",
          `The folder was dispatched but the drive does not hold ${id}.`,
          [{ path: "name" }],
        );
      }
      const path =
        [...folderPaths(after).entries()].find(([, fid]) => fid === id)?.[0] ??
        `/sources/${name}`;
      return Response.json({ id, name, path, created: true }, { status: 201 });
    } catch (error) {
      return jsonError(error);
    }
  };
}
