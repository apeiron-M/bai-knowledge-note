import {
  backfillOperationHistory,
  reactorSourceOpReader,
  type HistoryDocument,
  type SourceHistoryBackfillResult,
} from "../../../processors/graph-indexer/source-history-backfill.js";
import { getDb, getWritableDb, readerOf, type GraphSubgraph } from "./db.js";

/**
 * Backfill the drive's operation history into its graph index (see
 * `source-history-backfill.ts`), reading each document's log from the
 * reactor. By default the sources the index holds a row for; with `all`,
 * also every indexed document (`graph_nodes`) — which fills the first global
 * operations an index recorded before change history lost to the id
 * collision `migrations.ts` repairs. `driveId` is canonical.
 */
export async function backfillDriveSourceHistory(
  subgraph: GraphSubgraph,
  driveId: string,
  opts: { all?: boolean } = {},
): Promise<SourceHistoryBackfillResult> {
  const read = getDb(subgraph, driveId);
  const sources = await read
    .selectFrom("graph_sources")
    .select("document_id")
    .orderBy("document_id")
    .execute();
  const documents: HistoryDocument[] = sources.map((s) => ({
    documentId: s.document_id,
    documentType: "bai/source",
  }));
  if (opts.all) {
    const nodes = await read
      .selectFrom("graph_nodes")
      .select(["document_id", "document_type"])
      .orderBy("document_id")
      .execute();
    for (const n of nodes) {
      documents.push({
        documentId: n.document_id,
        documentType: n.document_type ?? "bai/knowledge-note",
      });
    }
  }
  const db = await getWritableDb(subgraph, driveId);
  return backfillOperationHistory(reactorSourceOpReader(readerOf(subgraph)), db, documents);
}
