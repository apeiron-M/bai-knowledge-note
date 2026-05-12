import type {
  ProcessorRecord,
  IProcessorHostModule,
} from "@powerhousedao/shared/processors";
import type { ProcessorFilter } from "@powerhousedao/shared/processors";
import type { PHDocumentHeader } from "document-model";
import { GraphIndexerProcessor } from "./index.js";

export const graphIndexerFactoryBuilder =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
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
