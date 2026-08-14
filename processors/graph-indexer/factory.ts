import type {
  ProcessorRecord,
  IProcessorHostModule,
} from "@powerhousedao/shared/processors";
import type { ProcessorFilter } from "@powerhousedao/shared/processors";
import type { PHDocumentHeader } from "document-model";
import { GraphIndexerProcessor } from "./index.js";

/** The drive-app whose drives this processor indexes and embeds. */
const KNOWLEDGE_VAULT_APP = "knowledge-vault";

/** Vetra's own development drives (document models, previews) never hold
 * knowledge notes and are recognizable by id in every code path. */
const isVetraSystemDrive = (driveId: string) =>
  driveId.startsWith("vetra-") || driveId.startsWith("preview-");

export const graphIndexerFactoryBuilder =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    // Scope: only knowledge-vault drives get a graph index + embeddings.
    // The processor manager broadcasts every filter-matching operation to
    // every instance regardless of drive (ProcessorFilter has no drive
    // dimension and OperationContext carries no driveId), so instance
    // count is the only lever we have: every instance we don't create is
    // one namespace that doesn't duplicate the vault's notes and one boot
    // backfill that doesn't re-embed them.
    //
    // Identification is best-effort by construction. Drives created while
    // the server runs arrive with their real header, so meta.preferredEditor
    // gates exactly. Drives that already existed at registration arrive as
    // reactor's createMinimalDriveHeader — no meta, no slug — so UUID
    // drives must fail OPEN: a pre-existing vault losing its index would
    // be far worse than a spurious namespace.
    if (isVetraSystemDrive(driveHeader.id)) {
      console.log(
        `[GraphIndexer] Skipping Vetra system drive ${driveHeader.id}`,
      );
      return [];
    }
    const app = driveHeader.meta?.preferredEditor;
    if (app && app !== KNOWLEDGE_VAULT_APP) {
      console.log(
        `[GraphIndexer] Skipping drive ${driveHeader.id} (app: ${app})`,
      );
      return [];
    }

    const namespace = GraphIndexerProcessor.getNamespace(driveHeader.id);
    console.log(
      `[GraphIndexer] Factory called for drive: ${driveHeader.id}, namespace: ${namespace}`,
    );

    const store =
      await module.relationalDb.createNamespace<GraphIndexerProcessor>(
        namespace,
      );

    // `scope: ["global", "document"]` — the indexer needs to see
    // ADD_RELATIONSHIP / REMOVE_RELATIONSHIP, which are reactor-native
    // system actions dispatched in `document` scope. Without that scope in
    // the filter, our indexer is blind to every edge change and
    // graph_edges never updates.
    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: [
        "bai/knowledge-note",
        "bai/moc",
        "powerhouse/document-drive",
      ],
      scope: ["global", "document"],
    };

    const processor = new GraphIndexerProcessor(namespace, filter, store);
    await processor.initAndUpgrade();

    console.log(
      `[GraphIndexer] Processor created for drive: ${driveHeader.id}`,
    );

    return [
      {
        processor,
        filter,
        startFrom: "beginning" as const,
      },
    ];
  };
