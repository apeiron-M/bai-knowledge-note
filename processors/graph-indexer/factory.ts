// `IProcessorHostModule` moved out of `@powerhousedao/shared/processors`
// in 6.2.2-dev.71 (only `IProcessorHostModuleBase` remains there); the
// codegen-emitted factory builders now source these types from
// reactor-browser, so this hand-written factory follows the same
// convention. Type-only: erased at compile time, safe in the
// switchboard (node) bundle.
import type {
  IProcessorHostModule,
  ProcessorFilter,
  ProcessorRecord,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import type { IReactorClient } from "@powerhousedao/reactor";
import { GraphIndexerProcessor } from "./index.js";
import { INDEXED_DOCUMENT_TYPES } from "./project.js";

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
    //
    // `documentType` is every kind the projection indexes (see project.ts)
    // plus the drive document itself, whose DELETE_NODE is how a deleted
    // document leaves the projection.
    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: [...INDEXED_DOCUMENT_TYPES, "powerhouse/document-drive"],
      scope: ["global", "document"],
    };

    // Derived-document automation runs on the Switchboard host only. The
    // browser instance indexes for its own reads but must never write, or
    // both hosts would open a tension for the same contradiction. `client`
    // is typed on the host module; guard structurally anyway so an older
    // host that lacks it degrades to read-only instead of throwing.
    const client = (module as { client?: IReactorClient }).client;
    const automate =
      module.processorApp !== "connect" &&
      typeof window === "undefined" &&
      client !== undefined;

    const processor = new GraphIndexerProcessor(namespace, filter, store, {
      automation: automate
        ? { driveId: driveHeader.id, client }
        : undefined,
    });
    await processor.initAndUpgrade();

    console.log(
      `[GraphIndexer] Processor created for drive: ${driveHeader.id}` +
        (processor.automationEnabled
          ? " (automation: CONTRADICTS → tension)"
          : " (read-only)"),
    );

    return [
      {
        processor,
        filter,
        startFrom: "beginning" as const,
      },
    ];
  };
