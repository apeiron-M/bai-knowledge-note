/**
 * Reducer replay shared by `validate-rows.ts` and `ref-scenarios.ts`: the
 * generated creator (`buildAction`, zod), then the model's own reducer;
 * an `operation.error` is a failure. A fixture step may name the ids its
 * `new-id` fields get (`newIds`, in field order), so a seeded state has
 * known, labeled items. Other ids come from a per-row counter, so a row's
 * ids do not depend on its position in the file.
 */
import type { Action, PHDocument } from "document-model";
import { CATALOG_MODELS } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { buildAction } from "../../editors/knowledge-vault/chat/core/envelope.js";
import type { CatalogEntry } from "../../editors/knowledge-vault/chat/core/op-catalog.js";

export interface FixtureStep {
  op: string;
  args: Record<string, unknown>;
  refIds?: Record<string, string | string[]>;
  /** Ids for this step's new-id fields, in field order. */
  newIds?: string[];
}

type Reducer = (doc: PHDocument, action: Action) => PHDocument;

export interface Replayer {
  reducer: Reducer;
  createDocument: () => PHDocument;
}

function isReducer(v: unknown): v is Reducer {
  return typeof v === "function";
}

export function replayers(): Map<string, Replayer> {
  const map = new Map<string, Replayer>();
  for (const { module, schemas } of CATALOG_MODELS) {
    const utils = schemas.utils as { createDocument?: () => PHDocument };
    const reducer = schemas.reducer;
    if (!isReducer(reducer) || typeof utils.createDocument !== "function") {
      throw new Error(`no reducer/utils for ${module.documentModel.global.id}`);
    }
    map.set(module.documentModel.global.id, {
      reducer,
      createDocument: utils.createDocument,
    });
  }
  return map;
}

export const REPLAY_NOW = "2026-10-20T12:00:00.000Z";

/** A per-row id source: named ids first, then a counter. */
export class IdSource {
  private n = 0;
  next(queue: string[] = []): () => string {
    return () =>
      queue.shift() ??
      `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`;
  }
}

export interface ApplyResult {
  doc: PHDocument;
  input?: Record<string, unknown>;
  error?: string;
  stage?: "zod" | "replay";
}

export function apply(
  doc: PHDocument,
  r: Replayer,
  entry: CatalogEntry,
  args: Record<string, unknown>,
  ids: IdSource,
  refIds?: Record<string, string | string[]>,
  newIds?: string[],
): ApplyResult {
  const built = buildAction(entry, args, {
    generateId: ids.next([...(newIds ?? [])]),
    now: () => REPLAY_NOW,
    actor: "training",
    refIds,
  });
  if (!built.ok) return { doc, error: built.error, stage: "zod" };
  const next = r.reducer(doc, built.action);
  const err = next.operations.global.at(-1)?.error;
  return err
    ? { doc: next, input: built.input, error: err, stage: "replay" }
    : { doc: next, input: built.input };
}

/** Replays `steps` on a fresh document of `docType`. */
export function replayFixture(
  catalog: Map<string, CatalogEntry>,
  reps: Map<string, Replayer>,
  docType: string,
  steps: FixtureStep[],
  ids: IdSource,
): { doc: PHDocument; error?: string } {
  const r = reps.get(docType);
  if (!r) throw new Error(`no reducer ${docType}`);
  let doc = r.createDocument();
  for (const [i, f] of steps.entries()) {
    const fe = catalog.get(f.op);
    if (!fe) return { doc, error: `unknown fixture op ${f.op}` };
    const res = apply(doc, r, fe, f.args, ids, f.refIds, f.newIds);
    if (res.error) return { doc, error: `step ${i} ${f.op}: ${res.error}` };
    doc = res.doc;
  }
  return { doc };
}
