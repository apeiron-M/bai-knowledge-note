import type {
  ProcessorRecord,
  IProcessorHostModule,
} from "@powerhousedao/reactor-browser";
import { type ProcessorFilter } from "@powerhousedao/shared/processors";
import type { PHDocumentHeader } from "document-model";
import { GraphIndexerProcessor } from "./index.js";

export const graphIndexerProcessorFactory =
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

    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["bai/knowledge-note", "bai/moc", "powerhouse/document-drive"],
      scope: ["global"],
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
