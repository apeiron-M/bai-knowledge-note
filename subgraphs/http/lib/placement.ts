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
 * Files documents created bare into a folder with ONE drive dispatch — every
 * `ADD_FILE` in one job. The reactor stores the drive's whole state with each
 * operation, so filing N documents one job at a time re-serialises the node
 * list N times (measured on a 1489-node drive: 4 documents 5.02 s one by one,
 * 1.41 s batched). Dispatched directly rather than through `executeWrite`: the
 * lint has no rules for `powerhouse/document-drive`.
 */
export async function containAll(
  deps: HttpRouteDeps,
  driveId: string,
  parentFolder: string,
  documentType: string,
  created: { id: string; name: string }[],
  ctx: RouteContext,
): Promise<void> {
  const actions = stampActions(
    created.map((c) => ({
      type: "ADD_FILE",
      input: { id: c.id, name: c.name, documentType, parentFolder },
    })),
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
  if (finished.error) throw new Error(finished.error.message);
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
