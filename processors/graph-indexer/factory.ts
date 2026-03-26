import type {
  ProcessorRecord,
  IProcessorHostModule,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import type { ProcessorApp } from "@powerhousedao/common";
import { GraphIndexerProcessor } from "./index.js";

export const graphIndexerProcessorFactory =
  (module: IProcessorHostModule) =>
  async (
    driveHeader: PHDocumentHeader,
    processorApp?: ProcessorApp,
  ): Promise<ProcessorRecord[]> => {
    // Create a namespace for the processor and the provided drive id
    const namespace = GraphIndexerProcessor.getNamespace(driveHeader.id);

    // Create a namespaced db for the processor
    const store =
      await module.relationalDb.createNamespace<GraphIndexerProcessor>(
        namespace,
      );

    // Create a filter for the processor
    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["bai/knowledge-note"],
      scope: ["global"],
    };

    // Create the processor
    const processor = new GraphIndexerProcessor(namespace, filter, store);
    return [
      {
        processor,
        filter,
      },
    ];
  };
