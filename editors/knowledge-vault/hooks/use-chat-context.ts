import { useMemo } from "react";
import {
  useDocumentSafe,
  useFileNodesInSelectedDrive,
  useSelectedDocumentId,
  useSelectedDriveId,
  useSelectedDriveSafe,
  useSelectedFolder,
} from "@powerhousedao/reactor-browser";
import { rankCandidates } from "../chat/context/candidates.js";
import { candidateDocs, toChatDocument } from "../chat/context/chat-document.js";
import {
  contextTargetFrom,
  type CandidateDoc,
  type ChatContextProvider,
  type ContextFrame,
  type DocumentTarget,
} from "../chat/context/context-frame.js";

export interface ChatContextValue {
  driveId: string;
  frame: ContextFrame;
  /** The drive's documents by name and type (never their state). */
  documents: CandidateDoc[];
  provider: ChatContextProvider;
}

/**
 * The chat's context from the drive app's selection, rebuilt every render
 * so the tag follows navigation live (also while the sheet is open). Reads
 * no document state except the open document's, without suspending.
 */
export function useChatContext(recent: DocumentTarget[]): ChatContextValue {
  const driveId = useSelectedDriveId() ?? "";
  const [drive] = useSelectedDriveSafe();
  const selectedId = useSelectedDocumentId();
  const folder = useSelectedFolder();
  const nodes = useFileNodesInSelectedDrive();
  const open = useDocumentSafe(selectedId);
  const node = nodes?.find((n) => n.id === selectedId);
  const loaded =
    open.data && open.data.header.id === selectedId ? toChatDocument(open.data) : undefined;

  const driveName = drive?.header.name || drive?.state.global.name || "";
  const nodeName = node?.name;
  const nodeType = node?.documentType;
  const title = loaded?.title;
  const docType = loaded?.docType;
  const target = useMemo(
    () =>
      contextTargetFrom({
        driveId,
        driveName,
        selectedId,
        node: nodeName !== undefined && nodeType ? { name: nodeName, documentType: nodeType } : undefined,
        loaded: title !== undefined && docType ? { docType, title } : undefined,
      }),
    [driveId, driveName, selectedId, nodeName, nodeType, title, docType],
  );

  const documents = useMemo(
    () => candidateDocs(nodes ?? [], target.kind === "document" ? [target, ...recent] : recent),
    [nodes, recent, target],
  );
  const folderId = folder?.id;

  return useMemo(() => {
    const frame: ContextFrame = {
      target,
      folderId,
      visibleIds: [],
      recentIds: recent.map((d) => d.id),
    };
    return {
      driveId,
      frame,
      documents,
      provider: {
        current: () => frame,
        candidates: (q, k) =>
          Promise.resolve(rankCandidates(q, documents, { recentIds: frame.recentIds, cap: k })),
        // M0 has no visible result list to count in
        resolveOrdinal: () => undefined,
      },
    };
  }, [driveId, documents, folderId, recent, target]);
}
