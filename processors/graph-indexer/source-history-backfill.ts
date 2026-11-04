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

/** Reads a document's global operation log, oldest first. */
export type SourceOpReader = {
  operations(documentId: string): AsyncIterable<SourceOp>;
};

export type SourceHistoryBackfillResult = {
  sources: number;
  inserted: number;
  skipped: number;
  errors: string[];
};

const PAGE_SIZE = 200;
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
 * global scope of the main branch, filtered to the recorded source actions.
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
    async *operations(documentId) {
      let cursor = "";
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = (await client.getOperations(
          documentId,
          { branch: "main", scopes: ["global"] },
          { actionTypes: [...RECORDED_SOURCE_ACTIONS] },
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

/**
 * Write the `graph_operations` rows the live indexer would have written for
 * these sources' history, had it recorded source operations all along (it
 * does since change history). Same row, same id, so an existing row is kept
 * (`onConflict doNothing`) and a second run inserts nothing. No reindex: the
 * index serves reads throughout. One source's failure is reported and the
 * rest go on.
 */
export async function backfillSourceHistory(
  reader: SourceOpReader,
  db: Pick<Kysely<DB>, "insertInto">,
  sourceIds: string[],
): Promise<SourceHistoryBackfillResult> {
  const result: SourceHistoryBackfillResult = {
    sources: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  };
  for (const documentId of sourceIds) {
    try {
      const rows = [];
      for await (const op of reader.operations(documentId)) {
        if (!RECORDED_SOURCE_ACTIONS.has(op.type)) continue;
        rows.push(
          operationRowOf({
            documentId,
            documentType: "bai/source",
            index: op.index,
            type: op.type,
            input: op.input,
            timestampUtcMs: op.timestampUtcMs,
            scope: "global",
            signer: op.signer,
          }),
        );
      }
      result.sources++;
      if (rows.length === 0) continue;
      const [written] = await db
        .insertInto("graph_operations")
        .values(rows)
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
      const inserted = Number(written?.numInsertedOrUpdatedRows ?? 0);
      result.inserted += inserted;
      result.skipped += rows.length - inserted;
    } catch (err) {
      result.errors.push(
        `${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return result;
}
