/**
 * This file aggregates all processor factories
 */

import type {
  ProcessorRecord,
  IProcessorHostModule,
  ProcessorFactory,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import { graphIndexerProcessorFactory } from "./graph-indexer/factory.js";

export const processorFactory = (module: IProcessorHostModule) => {
  console.log(
    `[processorFactory] Initializing with processorApp: ${module.processorApp}`,
  );

  const factories: ProcessorFactory[] = [];

  // Register graph indexer for both connect and switchboard
  factories.push(graphIndexerProcessorFactory(module));

  console.log(`[processorFactory] Loaded ${factories.length} factories`);

  // Return the inner function that will be called for each drive
  return async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    const processors: ProcessorRecord[] = [];

    for (const factory of factories) {
      const factoryProcessors = await factory(driveHeader, module.processorApp);
      processors.push(...factoryProcessors);
    }

    return processors;
  };
};
