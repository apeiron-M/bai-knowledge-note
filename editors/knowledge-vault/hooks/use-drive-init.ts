import { useEffect } from "react";
import {
  useSelectedDrive,
  useNodesInSelectedDrive,
  addDocument,
  addFolder,
} from "@powerhousedao/reactor-browser";
import type { Node } from "@powerhousedao/shared/document-drive";

/**
 * Drive folder structure matching Ars Contexta layout:
 *
 * /knowledge/              <- notes, MOCs, knowledge graph
 *   /knowledge/notes/      <- knowledge notes
 *   /knowledge/inbox/      <- unprocessed captures
 *   /knowledge/insights/   <- synthesized insights
 * /sources/                <- archived source material
 * /ops/                    <- operational coordination
 *   /ops/sessions/         <- session transcripts
 *   /ops/health/           <- health reports
 *   /ops/queue/            <- pipeline queue singleton
 * /self/                   <- system identity & config
 *   /self/methodology/     <- methodology notes
 *
 * Pattern: follows contributor-billing's proven approach —
 * module-level tracking Set per drive prevents duplicates,
 * sequential creation with delays for sync compatibility.
 */

// ─── Module-level state (survives re-renders, prevents duplicates) ───
const initStartedForDrives = new Set<string>();

type FolderSpec = { name: string; parentPath?: string };
type SingletonSpec = { name: string; type: string; folderPath: string };

// Flat list of folders to create (order matters — parents first)
const FOLDERS: FolderSpec[] = [
  { name: "knowledge" },
  { name: "notes", parentPath: "knowledge" },
  { name: "inbox", parentPath: "knowledge" },
  { name: "insights", parentPath: "knowledge" },
  { name: "sources" },
  { name: "ops" },
  { name: "sessions", parentPath: "ops" },
  { name: "health", parentPath: "ops" },
  { name: "queue", parentPath: "ops" },
  { name: "self" },
  { name: "methodology", parentPath: "self" },
];

const SINGLETONS: SingletonSpec[] = [
  {
    name: "PipelineQueue",
    type: "bai/pipeline-queue",
    folderPath: "ops/queue",
  },
  { name: "HealthReport", type: "bai/health-report", folderPath: "ops/health" },
  { name: "KnowledgeGraph", type: "bai/knowledge-graph", folderPath: "self" },
  { name: "VaultConfig", type: "bai/vault-config", folderPath: "self" },
];

export function useDriveInit() {
  const [selectedDrive] = useSelectedDrive();
  const driveId = selectedDrive?.header.id;
  const nodes = useNodesInSelectedDrive();

  useEffect(() => {
    if (!driveId || nodes === undefined) return;
    if (initStartedForDrives.has(driveId)) return;

    // Check if already initialized (knowledge folder exists)
    const hasKnowledgeFolder = (nodes ?? []).some(
      (n) =>
        n.kind === "folder" && n.name === "knowledge" && n.parentFolder == null,
    );
    if (hasKnowledgeFolder) {
      initStartedForDrives.add(driveId);
      return;
    }

    initStartedForDrives.add(driveId);
    void initDrive(driveId, nodes ?? []);
  }, [driveId, nodes]);
}

// ─── Single sequential init: folders then singletons ───
async function initDrive(driveId: string, existingNodes: Node[]) {
  try {
    // Phase 1: Create folders
    console.log(`[VaultInit] Creating folders for drive ${driveId}...`);
    const existingFolderMap = buildExistingFolderMap(existingNodes);
    const folderIds = new Map<string, string>(existingFolderMap);

    for (const folder of FOLDERS) {
      const path = folder.parentPath
        ? `${folder.parentPath}/${folder.name}`
        : folder.name;

      if (folderIds.has(path)) {
        continue;
      }

      const parentId = folder.parentPath
        ? folderIds.get(folder.parentPath)
        : undefined;

      try {
        const result = await addFolder(driveId, folder.name, parentId);
        folderIds.set(path, result.id);
        console.log(`[VaultInit] Created folder: /${path}/`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[VaultInit] Failed to create folder /${path}/:`, err);
      }
    }

    console.log("[VaultInit] Folders complete");

    // Wait for reactor to process all folder operations
    await new Promise((r) => setTimeout(r, 1500));

    // Phase 2: Create singletons
    console.log(`[VaultInit] Creating singletons...`);

    const existingTypes = new Set(
      existingNodes
        .filter((n) => n.kind === "file")
        .map(
          (n) =>
            (n as Node & { kind: "file"; documentType: string }).documentType,
        ),
    );

    for (const singleton of SINGLETONS) {
      if (existingTypes.has(singleton.type)) {
        console.log(`[VaultInit] ${singleton.name} already exists, skipping`);
        continue;
      }

      const parentFolderId = folderIds.get(singleton.folderPath);

      try {
        await addDocument(
          driveId,
          singleton.name,
          singleton.type,
          parentFolderId,
        );
        console.log(
          `[VaultInit] Created ${singleton.name} in /${singleton.folderPath}/`,
        );
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[VaultInit] Failed to create ${singleton.name}:`, err);
      }
    }

    console.log("[VaultInit] Drive initialization complete");
  } catch (err) {
    console.error("[VaultInit] Drive initialization failed:", err);
  }
}

// ─── Helpers ───

function buildExistingFolderMap(nodes: Node[]): Map<string, string> {
  const map = new Map<string, string>();
  const folders = nodes.filter((n) => n.kind === "folder");
  const folderById = new Map(folders.map((f) => [f.id, f]));

  for (const folder of folders) {
    const pathParts: string[] = [];
    let current: Node | undefined = folder;
    while (current) {
      pathParts.unshift(current.name);
      current = current.parentFolder
        ? folderById.get(current.parentFolder)
        : undefined;
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
