import type { Action } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { stampActions } from "./envelope.js";
import { folderPaths } from "./vault-folders.js";

interface DriveNode {
  id?: string;
  name?: string;
  documentType?: string;
  parentFolder?: string | null;
}

/**
 * The relationship the reactor keeps from a drive to each document in it. It is
 * half of containment — the drive's node tree is the other — and the half the
 * reactor acts on: document permissions inherit through it, and the drive's
 * sync collection is built from it.
 */
export const CONTAINMENT_RELATIONSHIP = "child";

/**
 * Contains documents created bare with TWO drive dispatches, however many there
 * are — the two halves the reactor's own `addFile` writes for one document:
 *
 * 1. The drive's "child" relationship to each, all in one document-scope job.
 *    Without it a grant on the drive never reaches the document: a user with
 *    READ on the drive is refused it ("Forbidden: insufficient permissions to
 *    read this document") although it sits in the drive, and a reactor syncing
 *    the drive never receives it. The operations land in the drive's
 *    document-scope log, so they do not re-serialise its node tree.
 * 2. Every `ADD_FILE` in one job. The reactor stores the drive's whole state
 *    with each operation, so filing N documents one job at a time re-serialises
 *    the node list N times (measured on a 1489-node drive: 4 documents 5.02 s
 *    one by one, 1.41 s batched).
 *
 * Relationship first, the order `addFile` uses. Dispatched directly rather than
 * through `executeWrite`: the lint has no rules for `powerhouse/document-drive`.
 * Each document used to get only the tree (fixed 2026-10-20);
 * `scripts/repair-containment.mjs` adds the relationship to those.
 */
export async function containAll(
  deps: HttpRouteDeps,
  driveId: string,
  parentFolder: string,
  documentType: string,
  created: { id: string; name: string }[],
  ctx: RouteContext,
): Promise<void> {
  const signal =
    ctx.signal && !ctx.signal.aborted ? ctx.signal : undefined;
  const dispatch = async (
    actions: Parameters<typeof stampActions>[0],
    scope: string,
  ): Promise<void> => {
    const job = await deps.reactorClient.executeAsync(
      driveId,
      "main",
      stampActions(actions, () => deps.now(), () => deps.uuid(), scope) as unknown as Action[],
      signal,
    );
    const finished = await deps.reactorClient.waitForJob(job.id, signal);
    if (finished.error) throw new Error(finished.error.message);
  };
  await dispatch(
    created.map((c) => ({
      type: "ADD_RELATIONSHIP",
      input: {
        sourceId: driveId,
        targetId: c.id,
        relationshipType: CONTAINMENT_RELATIONSHIP,
      },
    })),
    "document",
  );
  await dispatch(
    created.map((c) => ({
      type: "ADD_FILE",
      input: { id: c.id, name: c.name, documentType, parentFolder },
    })),
    "global",
  );
}

/** Where each document actually sits — read back from the drive, never echoed from a request. */
export async function placements(
  deps: HttpRouteDeps,
  driveId: string,
  ids: string[],
): Promise<Map<string, { parentFolder: string | null; path: string | null; name: string }>> {
  const drive = await deps.reactorClient.get(driveId);
  const nodes =
    (drive.state as { global?: { nodes?: DriveNode[] } } | undefined)?.global
      ?.nodes ?? [];
  const paths = folderPaths(nodes);
  const byFolder = new Map<string, string>();
  for (const [path, id] of paths) byFolder.set(id, path);

  const out = new Map<
    string,
    { parentFolder: string | null; path: string | null; name: string }
  >();
  for (const id of ids) {
    const node = nodes.find((n) => n.id === id);
    const parentFolder = node?.parentFolder ?? null;
    out.set(id, {
      parentFolder,
      path: parentFolder ? (byFolder.get(parentFolder) ?? null) : null,
      name: node?.name ?? "",
    });
  }
  return out;
}
