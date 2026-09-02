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

/** The document that marks a drive as a knowledge vault even when its header
 * predates `preferredEditor` — the same test the agent plugin uses. */
const VAULT_MARKER_DOCUMENT_TYPE = "bai/vault-config";

/** Vetra's own development drives (document models, previews) never hold
 * knowledge notes and are recognizable by id in every code path. */
const isVetraSystemDrive = (driveId: string) =>
  driveId.startsWith("vetra-") || driveId.startsWith("preview-");

type DriveVerdict =
  | { index: true; reason: string }
  | { index: false; reason: string };

/**
 * Decide whether a drive is a knowledge vault. Pure over the two facts that
 * identify one — the drive-app in its header and the presence of a
 * `bai/vault-config` node — so the factory and its tests share one rule.
 *
 *   - preferredEditor === "knowledge-vault" → index
 *   - any other preferredEditor → skip (it belongs to another app)
 *   - no preferredEditor: index only if the drive holds a vault-config;
 *     `nodes === null` means we could not read the drive → fail OPEN.
 */
export function judgeDrive(
  driveId: string,
  preferredEditor: string | null | undefined,
  nodes: ReadonlyArray<{ documentType?: string | null }> | null,
): DriveVerdict {
  if (isVetraSystemDrive(driveId)) {
    return { index: false, reason: "Vetra system drive" };
  }
  if (preferredEditor === KNOWLEDGE_VAULT_APP) {
    return { index: true, reason: `app: ${KNOWLEDGE_VAULT_APP}` };
  }
  if (preferredEditor) {
    return { index: false, reason: `app: ${preferredEditor}` };
  }
  if (nodes === null) {
    return {
      index: true,
      reason: "drive unreadable at registration — failing open",
    };
  }
  if (nodes.some((n) => n.documentType === VAULT_MARKER_DOCUMENT_TYPE)) {
    return { index: true, reason: `holds a ${VAULT_MARKER_DOCUMENT_TYPE}` };
  }
  return {
    index: false,
    reason: `no preferredEditor and no ${VAULT_MARKER_DOCUMENT_TYPE}`,
  };
}

/**
 * The header the manager hands a factory is only real for drives created
 * while the server runs. Drives that already existed at registration arrive
 * as reactor's `createMinimalDriveHeader` — no meta, no slug — so resolve
 * the truth through the client when the header is silent.
 */
async function resolveDrive(
  client: IReactorClient | undefined,
  driveHeader: PHDocumentHeader,
): Promise<{
  preferredEditor: string | null | undefined;
  nodes: Array<{ documentType?: string | null }> | null;
}> {
  const fromHeader = driveHeader.meta?.preferredEditor;
  if (fromHeader || !client) {
    return { preferredEditor: fromHeader, nodes: null };
  }
  try {
    const drive = (await client.get(driveHeader.id)) as {
      header?: { meta?: { preferredEditor?: string | null } };
      state?: {
        global?: { nodes?: Array<{ documentType?: string | null }> };
      };
    };
    return {
      preferredEditor: drive.header?.meta?.preferredEditor,
      nodes: drive.state?.global?.nodes ?? null,
    };
  } catch (error) {
    console.warn(
      `[GraphIndexer] Could not read drive ${driveHeader.id} at registration:`,
      error instanceof Error ? error.message : error,
    );
    return { preferredEditor: undefined, nodes: null };
  }
}

export const graphIndexerFactoryBuilder =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    // Scope: only knowledge-vault drives get a graph index + embeddings.
    // The processor manager broadcasts every filter-matching operation to
    // every instance regardless of drive (ProcessorFilter has no drive
    // dimension and OperationContext carries no driveId), so this gate is
    // the first of two: every instance we don't create is one namespace
    // that doesn't duplicate the vault's notes and one boot backfill that
    // doesn't re-embed them. The second gate — per-operation drive
    // membership inside the processor — keeps the instances we do create
    // from indexing each other's drives.
    //
    // `client` is typed on the host module; guard structurally anyway so an
    // older host that lacks it degrades to header-only identification.
    const client = (module as { client?: IReactorClient }).client;
    const { preferredEditor, nodes } = await resolveDrive(client, driveHeader);
    const verdict = judgeDrive(driveHeader.id, preferredEditor, nodes);
    if (!verdict.index) {
      console.log(
        `[GraphIndexer] Skipping drive ${driveHeader.id} (${verdict.reason})`,
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
    // both hosts would open a tension for the same contradiction.
    const automate =
      module.processorApp !== "connect" &&
      typeof window === "undefined" &&
      client !== undefined;

    const processor = new GraphIndexerProcessor(namespace, filter, store, {
      automation: automate
        ? { driveId: driveHeader.id, client }
        : undefined,
      // Second gate (see above). Without a client the processor cannot
      // learn who its members are and stays open, exactly as before.
      membership: client ? { driveId: driveHeader.id, client } : undefined,
    });
    await processor.initAndUpgrade();

    console.log(
      `[GraphIndexer] Processor created for drive: ${driveHeader.id} (${verdict.reason}` +
        (processor.membershipGated ? ", drive-scoped" : ", unscoped") +
        (processor.automationEnabled
          ? ", automation: CONTRADICTS → tension)"
          : ", read-only)"),
    );

    return [
      {
        processor,
        filter,
        startFrom: "beginning" as const,
      },
    ];
  };
