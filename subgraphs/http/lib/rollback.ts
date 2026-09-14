import type { HttpRouteDeps } from "./deps.js";
import { HttpError } from "./respond.js";

/**
 * The write surface's standing invariant: **a failed write never leaves the
 * vault worse than it found it.**
 *
 * Creating a document and placing it in its folder cannot be one transaction —
 * the reactor runs them as two jobs (`DriveClient.addFile`). A failure between
 * them strands the document at the drive root, where it is invisible to folder
 * views and to the pipeline, and where nothing will ever find it again. That is
 * the orphan a timed-out `switchboard docs create` produces, observed twice
 * live on 2026-09-14.
 *
 * Reporting the stranded ids and calling it the caller's problem is not good
 * enough: the caller asked for documents in a folder, and got invisible ones.
 * So every route that creates documents undoes its own work on failure.
 *
 * Scope of the rule, applied consistently across the surface:
 *
 * | failure | action | why |
 * |---|---|---|
 * | creation fails partway | roll back what was created | the caller has nothing usable |
 * | containment fails | roll back | otherwise orphans, invisible |
 * | a write AFTER containment fails | report, do not roll back | the document is visible, in the right folder, and its per-action errors are returned; deleting it would also discard the actions that did apply |
 *
 * Routes that only mutate EXISTING documents (`POST actions`, the relationship
 * verbs, `tasks/:id/claim`, `admin/reindex`) create nothing and so cannot
 * strand anything; operations are append-only and their errors are reported
 * per action.
 */
export async function rollbackDocuments(
  deps: HttpRouteDeps,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    await deps.reactorClient.deleteDocuments(ids);
    return [];
  } catch (error) {
    // Never claim a clean rollback we did not achieve. These ids are genuinely
    // stranded and the caller is the only one who can clean them up.
    console.error(
      `[http] rollback failed for ${ids.join(", ")}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return ids;
  }
}

/**
 * Rolls back and throws. `orphaned` is present only when the rollback itself
 * failed — its absence is the caller's assurance that nothing was left behind.
 */
export async function failAndRollback(
  deps: HttpRouteDeps,
  ids: string[],
  code: string,
  detail: string,
): Promise<never> {
  const stranded = await rollbackDocuments(deps, ids);
  throw new HttpError(
    502,
    code,
    stranded.length
      ? `${detail}. Rollback INCOMPLETE — these documents are stranded: ${stranded.join(", ")}`
      : `${detail}. Created documents were rolled back.`,
    stranded.length
      ? [{ path: "rollback", rule: "INCOMPLETE", orphaned: stranded }]
      : undefined,
  );
}

/**
 * Reads back where a document actually sits. Placement is never echoed from
 * the request: a create whose containment silently degraded must not be able
 * to look like a success.
 */
export async function readPlacement(
  deps: HttpRouteDeps,
  driveId: string,
  documentId: string,
): Promise<{ parentFolder: string | null; name: string | null }> {
  const drive = await deps.reactorClient.get(driveId);
  const nodes =
    (
      drive.state as
        | {
            global?: {
              nodes?: { id?: string; name?: string; parentFolder?: string | null }[];
            };
          }
        | undefined
    )?.global?.nodes ?? [];
  const node = nodes.find((n) => n.id === documentId);
  return {
    parentFolder: node?.parentFolder ?? null,
    name: node?.name ?? null,
  };
}
