import type {
  ProcessorRecord,
  IProcessorHostModule,
} from "@powerhousedao/reactor-browser";
import { type ProcessorFilter } from "@powerhousedao/shared/processors";
import type { PHDocumentHeader } from "document-model";
import { MethodologyIndexerProcessor } from "./index.js";

export const methodologyIndexerProcessorFactory =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    const namespace = MethodologyIndexerProcessor.getNamespace(driveHeader.id);
    console.log(
      `[MethodologyIndexer] Factory called for drive: ${driveHeader.id}, namespace: ${namespace}`,
    );

    const store =
      await module.relationalDb.createNamespace<MethodologyIndexerProcessor>(
        namespace,
      );

    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["bai/research-claim", "powerhouse/document-drive"],
      scope: ["global"],
    };

    const processor = new MethodologyIndexerProcessor(
      namespace,
      filter,
      store,
    );
    await processor.initAndUpgrade();

    console.log(
      `[MethodologyIndexer] Processor created for drive: ${driveHeader.id}`,
    );

    return [
      {
        processor,
        filter,
        startFrom: "beginning" as const,
      },
    ];
  };
