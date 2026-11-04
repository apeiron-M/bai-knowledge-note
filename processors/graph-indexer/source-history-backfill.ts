import type { Kysely } from "kysely";
import type { DB } from "./schema.js";
import { operationRowOf, RECORDED_SOURCE_ACTIONS } from "./operation-row.js";

/** One operation of a source's global log, as the backfill needs it. */
export type SourceOp = {
  index: number;
  type: string;
  input: unknown;
  timestampUtcMs: string;
  signer?: unknown;
};

/**
 * Reads a document's global operation log, oldest first — only `actionTypes`
 * when given, every operation otherwise.
 */
export type SourceOpReader = {
  operations(documentId: string, actionTypes?: readonly string[]): AsyncIterable<SourceOp>;
};

export type SourceHistoryBackfillResult = {
  /** Sources whose log was read. */
  sources: number;
  /** Other indexed documents whose log was read (`all` only). */
  documents: number;
  inserted: number;
  skipped: number;
  errors: string[];
};

const PAGE_SIZE = 200;
/** Rows per INSERT: 13 columns each, far under Postgres's 65,535 bound parameters. */
const INSERT_CHUNK = 500;
/** A source with more pages than this is a runaway cursor, not a log. */
const MAX_PAGES = 500;

type PagedOperations = {
  results: Array<{
    index: number;
    timestampUtcMs: string;
    action?: { type?: string; input?: unknown; context?: { signer?: unknown } };
  }>;
  nextCursor?: string;
};

/**
 * A {@link SourceOpReader} over the reactor client's operation paging,
 * global scope of the main branch.
 */
export function reactorSourceOpReader(client: {
  getOperations(
    documentIdentifier: string,
    view?: { branch?: string; scopes?: string[] },
    filter?: { actionTypes?: string[] },
    paging?: { cursor: string; limit: number },
  ): Promise<unknown>;
}): SourceOpReader {
  return {
    async *operations(documentId, actionTypes) {
      let cursor = "";
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = (await client.getOperations(
          documentId,
          { branch: "main", scopes: ["global"] },
          actionTypes ? { actionTypes: [...actionTypes] } : undefined,
          { cursor, limit: PAGE_SIZE },
        )) as PagedOperations;
        for (const op of result.results) {
          yield {
            index: op.index,
            type: op.action?.type ?? "",
            input: op.action?.input,
            timestampUtcMs: op.timestampUtcMs,
            signer: op.action?.context?.signer,
          };
        }
        if (!result.nextCursor) return;
        cursor = result.nextCursor;
      }
    },
  };
}

/** A document whose history the backfill reads, and its type. */
export type HistoryDocument = { documentId: string; documentType: string };

/**
 * Write the `graph_operations` rows the live indexer would have written for
 * these documents' global history: every global operation of an indexed
 * document, the recorded source actions of a source. Same row, same id
 * (`operation-row.ts`), so an existing row is kept (`onConflict doNothing`)
 * and a second run inserts nothing. It fills what an index recorded before
 * change history lacks — every source operation, and the first global
 * operations of each document, lost to an id collision (see the id repair in
 * `migrations.ts`). No reindex: the index serves reads throughout. One
 * document's failure is reported and the rest go on.
 */
export async function backfillOperationHistory(
  reader: SourceOpReader,
  db: Pick<Kysely<DB>, "insertInto">,
  documents: readonly HistoryDocument[],
): Promise<SourceHistoryBackfillResult> {
  const result: SourceHistoryBackfillResult = {
    sources: 0,
    documents: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  };
  const sourceActions = [...RECORDED_SOURCE_ACTIONS];
  for (const { documentId, documentType } of documents) {
    const isSource = documentType === "bai/source";
    try {
      const rows = [];
      for await (const op of reader.operations(documentId, isSource ? sourceActions : undefined)) {
        if (isSource && !RECORDED_SOURCE_ACTIONS.has(op.type)) continue;
        rows.push(
          operationRowOf({
            documentId,
            documentType,
            index: op.index,
            type: op.type,
            input: op.input,
            timestampUtcMs: op.timestampUtcMs,
            scope: "global",
            signer: op.signer,
          }),
        );
      }
      if (isSource) result.sources++;
      else result.documents++;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const part = rows.slice(i, i + INSERT_CHUNK);
        const [written] = await db
          .insertInto("graph_operations")
          .values(part)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
        const inserted = Number(written?.numInsertedOrUpdatedRows ?? 0);
        result.inserted += inserted;
        result.skipped += part.length - inserted;
      }
    } catch (err) {
      result.errors.push(
        `${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return result;
}

/** {@link backfillOperationHistory} over sources only — the original backfill. */
export function backfillSourceHistory(
  reader: SourceOpReader,
  db: Pick<Kysely<DB>, "insertInto">,
  sourceIds: readonly string[],
): Promise<SourceHistoryBackfillResult> {
  return backfillOperationHistory(
    reader,
    db,
    sourceIds.map((documentId) => ({ documentId, documentType: "bai/source" })),
  );
}
