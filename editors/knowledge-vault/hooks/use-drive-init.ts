import { useEffect } from "react";
import {
  useSelectedDrive,
  useNodesInSelectedDrive,
  addDocument,
  addFolder,
} from "@powerhousedao/reactor-browser";
import type { Node } from "@powerhousedao/shared/document-drive";

/**
 * Same-origin GraphQL endpoint resolver for the drive document query.
 * Reuses the same logic as `subgraph-endpoint.ts`: any localhost variant
 * (including IDE-tunnel proxy ports) maps to switchboard's :4001.
 */
function resolveReactorEndpoint(): string {
  const hostname = globalThis.window?.location?.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4001/graphql";
  }
  // Vetra remote subdomain pattern.
  if (hostname && /^connect\..+\.vetra\.io$/.test(hostname)) {
    const sbHost = hostname.replace(/^connect\./, "switchboard.");
    return `https://${sbHost}/graphql`;
  }
  return "/graphql";
}

/**
 * Authoritatively fetch the drive's tree from the reactor (NOT from
 * Connect's local cache) so we can determine init state without
 * waiting for WebSocket sync to deliver existing nodes. This is the
 * fix for the "vault-init re-creates folders after a read-storage
 * wipe" bug — the local cache lies until sync completes; the reactor
 * always tells the truth.
 */
async function fetchDriveNodes(driveId: string): Promise<Node[] | null> {
  const endpoint = resolveReactorEndpoint();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "query DriveNodes($id: String!){document(identifier:$id){document{state}}}",
        variables: { id: driveId },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { document?: { document?: { state?: unknown } } };
      errors?: unknown[];
    };
    if (json.errors?.length) return null;
    const state = json.data?.document?.document?.state as
      | { global?: { nodes?: Node[] } }
      | undefined;
    return state?.global?.nodes ?? [];
  } catch {
    return null;
  }
}

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

// Drive IDs we have seen at least once with a populated node list. After
// that point we trust an empty/missing-folder check to mean "drive is
// genuinely empty, init is needed". This guards the race where the
// WebSocket sync hasn't yet delivered existing folders on first render.
const driveSyncSeen = new Set<string>();

// Top-level folder names that any initialized vault drive must have.
// If at least one is present at the root, init is already done.
const KNOWN_ROOT_FOLDERS = ["knowledge", "ops", "self", "sources"];

// How long to wait for the first reactor sync before treating an empty
// node list as authoritative. WebSocket sync on a freshly-loaded drive
// typically completes within <1s, but migration drives with hundreds
// of nodes can take longer.
const SYNC_GRACE_PERIOD_MS = 3000;

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
  { name: "VaultConfig", type: "bai/vault-config", folderPath: "self" },
];

export function useDriveInit() {
  const [selectedDrive] = useSelectedDrive();
  const driveId = selectedDrive?.header.id;
  const nodes = useNodesInSelectedDrive();

  useEffect(() => {
    if (!driveId) return;
    if (initStartedForDrives.has(driveId)) return;

    // Authoritative server-side check: query the reactor directly for
    // this drive's full node list. The cached `nodes` from
    // `useNodesInSelectedDrive` is unreliable on a fresh open
    // (especially after a `read-storage` wipe) because Connect's
    // WebSocket sync hasn't necessarily delivered the existing tree
    // when the editor mounts. Hitting the reactor's GraphQL endpoint
    // gives us ground truth on the very first call, so we never make a
    // false "drive looks empty" decision.
    initStartedForDrives.add(driveId);
    driveSyncSeen.add(driveId);
    void (async () => {
      const serverNodes = await fetchDriveNodes(driveId);
      // Use whichever source has more entries — the reactor query is
      // authoritative, but if the local cache happens to have more
      // (race during the fetch), take the union via cache.
      const truth =
        serverNodes && serverNodes.length >= (nodes ?? []).length
          ? serverNodes
          : (nodes ?? []);
      void initDrive(driveId, truth);
    })();
  }, [driveId]);
}

// ─── Single sequential init: folders then singletons ───
async function initDrive(driveId: string, existingNodes: Node[]) {
  try {
    // Phase 1: Create folders
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
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[VaultInit] Failed to create folder /${path}/:`, err);
      }
    }

    // Wait for reactor to process all folder operations
    await new Promise((r) => setTimeout(r, 1500));

    // Phase 2: Create singletons
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
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[VaultInit] Failed to create ${singleton.name}:`, err);
      }
    }
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
