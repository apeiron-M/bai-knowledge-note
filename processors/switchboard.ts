import type { ProcessorFactoryBuilder } from "@powerhousedao/reactor";
import { graphIndexerProcessorFactory } from "./graph-indexer/factory.js";

export const processorFactoryBuilders: ProcessorFactoryBuilder[] = [
  graphIndexerProcessorFactory,
];
