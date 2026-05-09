/**
 * Ensures a bai/knowledge-graph document exists in the given drive.
 * Called lazily on first query — supports API/plugin access without
 * requiring the Connect UI to have initialized the drive first.
 */
import type { ISubgraph } from "@powerhousedao/reactor-api";

const ensuredDrives = new Set<string>();

export async function ensureGraphDoc(
  subgraph: ISubgraph,
  driveId: string,
): Promise<void> {
  if (ensuredDrives.has(driveId)) return;
  ensuredDrives.add(driveId);

  try {
    const drive = await subgraph.reactorClient.get(driveId);
    const nodes = (
      drive.state as unknown as {
        global: {
          nodes: Array<{
            kind: string;
            documentType?: string;
            id: string;
            name: string;
            parentFolder?: string | null;
          }>;
        };
      }
    ).global.nodes;

    const hasGraph = nodes.some(
      (n) => n.kind === "file" && n.documentType === "bai/knowledge-graph",
    );

    if (!hasGraph) {
      const selfFolder = nodes.find(
        (n) =>
          n.kind === "folder" && n.name === "self" && n.parentFolder == null,
      );
      const parentFolder = selfFolder?.id;

      await subgraph.reactorClient.createEmpty("bai/knowledge-graph", {
        parentIdentifier: parentFolder ?? driveId,
      });
      console.log(
        `[KnowledgeGraphSubgraph] Auto-created KnowledgeGraph in drive ${driveId}` +
          (parentFolder
            ? ` (folder: /self/)`
            : ` (drive root -- /self/ folder not found)`),
      );
    }
  } catch (err: unknown) {
    console.error(`[KnowledgeGraphSubgraph] Failed to ensure graph doc:`, err);
    // Don't block queries if this fails — processor data still works
  }
}
