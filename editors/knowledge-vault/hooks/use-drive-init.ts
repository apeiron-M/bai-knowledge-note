import { useEffect, useRef } from "react";
import {
  useSelectedDriveId,
  useNodesInSelectedDrive,
  addDocument,
  addFolder,
} from "@powerhousedao/reactor-browser";
import type { Node } from "document-drive";

/**
 * Drive folder structure matching Ars Contexta layout:
 *
 * /knowledge/              ← notes, MOCs, knowledge graph
 *   /knowledge/inbox/      ← unprocessed sources waiting for extraction
 *   /knowledge/insights/   ← extracted atomic claims (knowledge notes)
 * /sources/                ← archived source material
 * /ops/                    ← operational coordination
 *   /ops/sessions/         ← session transcripts
 *   /ops/health/           ← health reports
 *   /ops/queue/            ← pipeline queue singleton
 * /self/                   ← system identity & config
 *   /self/methodology/     ← methodology notes
 * /research/               ← bundled research claims
 */

type FolderDef = {
  name: string;
  children?: FolderDef[];
};

const FOLDER_TREE: FolderDef[] = [
  {
    name: "knowledge",
    children: [
      { name: "inbox" },
      { name: "insights" },
    ],
  },
  { name: "sources" },
  {
    name: "ops",
    children: [
      { name: "sessions" },
      { name: "health" },
      { name: "queue" },
    ],
  },
  {
    name: "self",
    children: [
      { name: "methodology" },
    ],
  },
  { name: "research" },
];

type SingletonDef = {
  name: string;
  type: string;
  folderPath: string; // e.g. "ops/queue"
};

const SINGLETONS: SingletonDef[] = [
  { name: "PipelineQueue", type: "bai/pipeline-queue", folderPath: "ops/queue" },
  { name: "KnowledgeGraph", type: "bai/knowledge-graph", folderPath: "knowledge" },
  { name: "VaultConfig", type: "bai/vault-config", folderPath: "self" },
];

export function useDriveInit() {
  const driveId = useSelectedDriveId();
  const nodes = useNodesInSelectedDrive();
  const initAttempted = useRef(false);

  useEffect(() => {
    if (!driveId || initAttempted.current) return;
    if (nodes === undefined) return; // still loading

    // Check if the root "knowledge" folder exists (our init marker)
    const hasKnowledgeFolder = (nodes ?? []).some(
      (n) => n.kind === "folder" && n.name === "knowledge" && n.parentFolder == null,
    );

    if (hasKnowledgeFolder) return; // already initialized

    initAttempted.current = true;
    initDrive(driveId, nodes ?? []);
  }, [driveId, nodes]);
}

async function initDrive(driveId: string, existingNodes: Node[]) {
  try {
    console.log("[VaultInit] Initializing drive folder structure...");

    // Build map of existing folders: path -> id
    const existingFolderIds = buildExistingFolderMap(existingNodes);
    const folderIds = new Map<string, string>(existingFolderIds);

    // Create folder tree recursively
    await createFolderTree(driveId, FOLDER_TREE, null, "", folderIds);

    // Create singleton documents in their folders
    const existingTypes = new Set(
      existingNodes
        .filter((n): n is Node & { kind: "file"; documentType: string } => n.kind === "file")
        .map((n) => n.documentType),
    );

    for (const singleton of SINGLETONS) {
      if (existingTypes.has(singleton.type)) continue;
      const parentId = folderIds.get(singleton.folderPath);
      try {
        await addDocument(driveId, singleton.name, singleton.type, parentId);
        console.log(`[VaultInit] Created ${singleton.name} in /${singleton.folderPath}/`);
      } catch (err) {
        console.error(`[VaultInit] Failed to create ${singleton.name}:`, err);
      }
    }

    console.log("[VaultInit] Drive initialization complete");
  } catch (err) {
    console.error("[VaultInit] Drive initialization failed:", err);
  }
}

async function createFolderTree(
  driveId: string,
  defs: FolderDef[],
  parentFolderId: string | null | undefined,
  pathPrefix: string,
  folderIds: Map<string, string>,
) {
  for (const def of defs) {
    const path = pathPrefix ? `${pathPrefix}/${def.name}` : def.name;

    if (!folderIds.has(path)) {
      try {
        const result = await addFolder(driveId, def.name, parentFolderId ?? undefined);
        folderIds.set(path, result.id);
        console.log(`[VaultInit] Created folder: /${path}/`);
      } catch (err) {
        console.error(`[VaultInit] Failed to create folder /${path}/:`, err);
        continue;
      }
    }

    if (def.children) {
      await createFolderTree(driveId, def.children, folderIds.get(path), path, folderIds);
    }
  }
}

function buildExistingFolderMap(nodes: Node[]): Map<string, string> {
  const map = new Map<string, string>();
  const folders = nodes.filter((n): n is Node & { kind: "folder" } => n.kind === "folder");
  const folderById = new Map(folders.map((f) => [f.id, f]));

  for (const folder of folders) {
    const pathParts: string[] = [];
    let current: (Node & { kind: "folder" }) | undefined = folder;
    while (current) {
      pathParts.unshift(current.name);
      current = current.parentFolder ? folderById.get(current.parentFolder) as (Node & { kind: "folder" }) | undefined : undefined;
    }
    map.set(pathParts.join("/"), folder.id);
  }

  return map;
}

/**
 * Hook to get a map of folder paths to folder IDs.
 * Useful for placing documents in the correct folder.
 */
export function useFolderMap() {
  const nodes = useNodesInSelectedDrive();
  if (!nodes) return new Map<string, string>();
  return buildExistingFolderMap(nodes);
}
