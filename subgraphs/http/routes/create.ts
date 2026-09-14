import type { Action, PHDocument } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { stampActions, type RawAction } from "../lib/envelope.js";
import { lintActions } from "../lib/lint/index.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { rejectUnknownFields } from "../lib/validate.js";
import { failAndRollback } from "../lib/rollback.js";
import { folderPaths, resolveVaultFolder } from "../lib/vault-folders.js";
import { executeWrite } from "../lib/write.js";

const MAX_NOTES = 25;
const DEFAULT_TYPE = "bai/knowledge-note";

interface NoteSpec {
  name?: string;
  actions?: RawAction[];
}

interface CreateNotesBody {
  drive?: string;
  documentType?: string;
  notes?: NoteSpec[];
  /** Not accepted — placement is the API's job. Present only to reject it. */
  parentFolder?: string;
}

interface DriveNode {
  id?: string;
  name?: string;
  documentType?: string;
  parentFolder?: string | null;
}

/**
 * `POST notes` — create many documents and place them, in one request.
 *
 * **Why this route exists.** Creating documents one at a time is the dominant
 * cost of extraction. Each create dispatches its own `ADD_FILE` against the
 * drive, and the reactor stores a full JSON copy of the drive's state with
 * every operation — so N creates re-serialise the whole node list N times.
 * Batching the containment into one dispatch pays that once. Measured on a
 * 1489-node drive: 4 documents took 5.02s created one by one, 1.41s batched.
 *
 * **The invariant: this route never leaves the vault worse than it found it.**
 * Document creation and containment cannot be one transaction, so a failure
 * between them would strand documents at the drive root — invisible to folder
 * views and to the pipeline, exactly the orphan the CLI produces on a timed-out
 * create. Rather than report those ids and make them the caller's problem, the
 * route deletes what it created and fails clean.
 */
export function createNotesRoute(deps: HttpRouteDeps) {
  return async function handleCreateNotes(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      let body: CreateNotesBody;
      try {
        body = (await request.json()) as CreateNotesBody;
      } catch {
        throw new HttpError(400, "BAD_REQUEST", "body must be JSON");
      }
      rejectUnknownFields(body as unknown as Record<string, unknown>, [
        "drive",
        "documentType",
        "notes",
        "parentFolder",
      ]);
      if (!body.drive) {
        throw new HttpError(400, "BAD_REQUEST", "drive is required");
      }
      if (body.parentFolder !== undefined) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "parentFolder is not accepted: placement follows the document type",
          [{ path: "parentFolder", rule: "VAULT_LAYOUT" }],
        );
      }
      const notes = body.notes;
      if (!Array.isArray(notes) || notes.length === 0) {
        throw new HttpError(400, "BAD_REQUEST", "notes must be a non-empty array");
      }
      if (notes.length > MAX_NOTES) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `at most ${MAX_NOTES} notes per request, got ${notes.length}`,
        );
      }
      const names = notes.map((note, index) => {
        const name = note.name?.trim();
        if (!name) {
          throw new HttpError(400, "BAD_REQUEST", `notes[${index}].name is required`, [
            { path: `notes[${index}].name` },
          ]);
        }
        return name;
      });
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      if (duplicates.length) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `duplicate names in one request: ${[...new Set(duplicates)].join(", ")}`,
        );
      }

      const documentType = body.documentType ?? DEFAULT_TYPE;
      const driveId = await canonicalForWrite(deps, body.drive, ctx);
      // Resolve placement BEFORE creating anything, so an unresolvable folder
      // fails with nothing written.
      const folderId = await resolveVaultFolder(deps, driveId, documentType);

      // Lint EVERY note up front. A 400 must mean nothing was dispatched, and
      // that guarantee is worth more here than anywhere else: a lint failure
      // discovered halfway through would leave half the batch created.
      const module = await deps.reactorClient.getDocumentModelModule(documentType);
      const probe = module.utils.createDocument() as PHDocument;
      notes.forEach((note, index) => {
        if (!note.actions?.length) return;
        const findings = lintActions(documentType, probe.state, note.actions);
        if (findings.length) {
          throw new HttpError(
            400,
            findings.some((f) => f.class === "REACTOR_REJECTS")
              ? "LINT_REACTOR"
              : "LINT_CONVENTION",
            `${findings.length} lint findings in notes[${index}]`,
            findings.map((f) => ({ ...f, path: `notes[${index}].${f.path}` })),
          );
        }
      });

      // Phase 1 — create the documents bare, with no parentIdentifier. A
      // parented create costs ~1s against ~0.24s bare, and does its own
      // containment dispatch, which is the thing we are batching. Sequential
      // on purpose: the reactor executes one job at a time, so issuing these
      // concurrently only queues them.
      const created: { id: string; name: string }[] = [];
      try {
        for (const name of names) {
          const draft = module.utils.createDocument() as PHDocument;
          draft.header.name = name;
          const doc = await deps.reactorClient.create(draft);
          created.push({ id: doc.header.id, name });
        }
      } catch (error) {
        await failAndRollback(
          deps,
          created.map((c) => c.id),
          "CREATE_FAILED",
          `Document creation failed: ${message(error)}`,
        );
      }

      // Phase 2 — ONE dispatch containing every ADD_FILE. This is the saving.
      // Dispatched directly rather than through executeWrite: the lint has no
      // rules for `powerhouse/document-drive` and would reject the batch as an
      // unknown document type.
      try {
        await containAll(deps, driveId, folderId, documentType, created, ctx);
      } catch (error) {
        // The orphan case. Delete what we made rather than hand back ids the
        // caller would have to clean up themselves.
        await failAndRollback(
          deps,
          created.map((c) => c.id),
          "CONTAINMENT_FAILED",
          `Containment failed: ${message(error)}`,
        );
      }

      // Verify containment actually happened before populating. A job can
      // report success without the node landing, and a document at the drive
      // root is invisible — so this is checked, not assumed.
      const placed = await placements(deps, driveId, created.map((c) => c.id));
      const misplaced = created.filter(
        (c) => placed.get(c.id)?.parentFolder !== folderId,
      );
      if (misplaced.length) {
        await failAndRollback(
          deps,
          created.map((c) => c.id),
          "CONTAINMENT_FAILED",
          `${misplaced.length} of ${created.length} documents were created but not placed`,
        );
      }

      // Phase 3 — populate. These documents are now created AND placed, so a
      // failure here is not an orphan: the note exists where it belongs and is
      // reported with its per-action errors. Rolling back here would also
      // discard the actions that did apply.
      const results = [];
      for (const [index, note] of notes.entries()) {
        const { id, name } = created[index];
        if (!note.actions?.length) {
          results.push({ id, name, readBack: "skipped" as const, operations: [] });
          continue;
        }
        const document = await deps.reactorClient.get(id);
        const write = await executeWrite(deps, {
          documentId: id,
          document,
          actions: note.actions,
          ctx,
          wait: true,
        });
        results.push({
          id,
          name,
          readBack: write.readBack,
          operations: write.operations,
        });
      }

      // Placement below is the verified read-back from above, never echoed
      // from the request. The drive renames on collision, so the stored name
      // can differ from the requested one.
      return Response.json(
        {
          drive: driveId,
          parentFolder: folderId,
          notes: results.map((r) => ({
            ...r,
            name: placed.get(r.id)?.name ?? r.name,
            parentFolder: placed.get(r.id)?.parentFolder ?? null,
            path: placed.get(r.id)?.path ?? null,
          })),
        },
        { headers: OK_CACHE, status: 201 },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function containAll(
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

async function placements(
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
