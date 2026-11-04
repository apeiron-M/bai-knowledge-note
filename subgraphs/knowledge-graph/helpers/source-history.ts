import {
  backfillSourceHistory,
  reactorSourceOpReader,
  type SourceHistoryBackfillResult,
} from "../../../processors/graph-indexer/source-history-backfill.js";
import { getDb, getWritableDb, readerOf, type GraphSubgraph } from "./db.js";

/**
 * Backfill the drive's source operation history into its graph index (see
 * `source-history-backfill.ts`). The sources are the ones the index holds a
 * row for; their logs are read from the reactor. `driveId` is canonical.
 */
export async function backfillDriveSourceHistory(
  subgraph: GraphSubgraph,
  driveId: string,
): Promise<SourceHistoryBackfillResult> {
  const sources = await getDb(subgraph, driveId)
    .selectFrom("graph_sources")
    .select("document_id")
    .orderBy("document_id")
    .execute();
  const db = await getWritableDb(subgraph, driveId);
  return backfillSourceHistory(
    reactorSourceOpReader(readerOf(subgraph)),
    db,
    sources.map((s) => s.document_id),
  );
}
