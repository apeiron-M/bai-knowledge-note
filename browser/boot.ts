/**
 * Starting the browser vault: engine, seed, index, the page's Switchboard,
 * the host declaration and the `window.ph` slots the vault app reads.
 */
import type { IReactorClient } from "@powerhousedao/reactor";
import {
  DocumentCache,
  ensurePHEventHandlers,
  setPHGlobalConfig,
  syncSelectionFromPath,
  setDocumentCache,
  setDrives,
  setReactorClient,
  setSelectedDrive,
  setVetraPackageManager,
  StaticPackageManager,
} from "@powerhousedao/reactor-browser";
import type { DocumentDriveDocument } from "@powerhousedao/shared/document-drive";
import type { DocumentModelLib, DocumentModelModule, PHDocument } from "document-model";
import { documentModels } from "../document-models/document-models.js";
import { upgradeManifests } from "../document-models/upgrade-manifests.js";
import { editors } from "../editors/editors.js";
import { setHostConfig, type KnowledgeVaultHostDocuments } from "../editors/shared/host-config.js";
import manifest from "../powerhouse.manifest.json" with { type: "json" };
import { createCoreGraphQLService } from "./core-graphql.js";
import { createBrowserEngine, engineDatabases, type BrowserEngine } from "./engine.js";
import { createKnowledgeGraphService } from "./knowledge-graph.js";
import { startLiveFeed } from "./live-feed.js";
import { installLocalOrigin, LOCAL_ORIGIN } from "./local-origin.js";
import { createPageSubgraph } from "./page-subgraph.js";
import { createRestService } from "./rest.js";
import { seedVault, VAULT_APP_ID, type SeedProgress, type VaultSeed } from "./seed.js";

export type BootOptions = {
  namespace: string;
  /** The page path the vault lives under (its own URLs go below it), e.g. "/try/". */
  basePath?: string;
  loadSeed: () => Promise<VaultSeed>;
  onProgress?: (stage: string, done?: number, total?: number) => void;
};

export type BootedVault = {
  engine: BrowserEngine;
  driveId: string;
  /** The vault was seeded from another version of the starting content. */
  outdated: boolean;
  stop(): Promise<void>;
};

type SeedStamp = { version: string; driveId: string };

const stampKey = (namespace: string) => `${namespace}:seed`;

function readStamp(namespace: string): SeedStamp | null {
  try {
    const raw = localStorage.getItem(stampKey(namespace));
    return raw ? (JSON.parse(raw) as SeedStamp) : null;
  } catch {
    return null;
  }
}

function writeStamp(namespace: string, stamp: SeedStamp): void {
  try {
    localStorage.setItem(stampKey(namespace), JSON.stringify(stamp));
  } catch {
    // A missing stamp only means the next visit re-checks the drive itself.
  }
}

/** The vault package as Connect would load it: models, editors, manifest. */
const vaultLibrary = {
  manifest,
  documentModels,
  editors,
  upgradeManifests,
} as unknown as DocumentModelLib;

function toAction(action: { type: string; input: Record<string, unknown>; scope?: string }) {
  return {
    id: crypto.randomUUID(),
    timestampUtcMs: new Date().toISOString(),
    scope: action.scope ?? "global",
    type: action.type,
    input: action.input,
  };
}

/** The document writes the vault's helpers hand to the browser host. */
function hostDocuments(
  client: IReactorClient,
  models: readonly DocumentModelModule[],
): KnowledgeVaultHostDocuments {
  return {
    async create({ documentType, name, driveId, parentFolderId }) {
      const module = models.find((m) => m.documentModel.global.id === documentType);
      if (!module) throw new Error(`The browser vault has no document model for ${documentType}.`);
      const document = module.utils.createDocument() as PHDocument;
      document.header.name = name;
      const created = await client.drives.addFile(driveId, document, parentFolderId);
      return created.header.id;
    },
    async addFolder({ driveId, name, parentFolderId }) {
      const folder = await client.drives.addFolder(driveId, name, parentFolderId);
      return folder.id;
    },
    async mutate(documentId, actions) {
      await client.execute(documentId, "main", actions.map(toAction) as never);
    },
    async remove(documentId, driveId) {
      if (driveId) await client.drives.removeNode(driveId, documentId);
      else await client.deleteDocument(documentId);
    },
  };
}

async function findVaultDrive(client: IReactorClient, driveId?: string): Promise<string | undefined> {
  if (driveId) {
    const known = await client.get<PHDocument>(driveId).catch(() => undefined);
    if (known) return known.header.id;
  }
  const drives = await client.find({ type: "powerhouse/document-drive" });
  const vault = drives.results.find(
    (d) => (d.header.meta as { preferredEditor?: string } | undefined)?.preferredEditor === VAULT_APP_ID,
  );
  return vault?.header.id;
}

export async function bootBrowserVault(options: BootOptions): Promise<BootedVault> {
  const { namespace, onProgress } = options;
  const started = performance.now();
  const timings: Record<string, number> = {};
  const mark = (stage: string) => {
    timings[stage] = Math.round(performance.now() - started);
  };
  onProgress?.("engine");
  const engine = await createBrowserEngine(namespace);
  const { client, relationalDb, models } = engine;
  const subgraph = createPageSubgraph(client, relationalDb);
  const knowledgeGraph = createKnowledgeGraphService(subgraph);
  mark("engine");

  const stamp = readStamp(namespace);
  let driveId = await findVaultDrive(client, stamp?.driveId);
  let outdated = false;
  const seed = driveId ? null : await options.loadSeed();
  if (!driveId && seed) {
    onProgress?.("seed", 0, seed.documents.length + seed.relationships.length);
    const progress: SeedProgress = (done, total) => onProgress?.("seed", done, total);
    driveId = await seedVault(client, models, seed, progress);
    writeStamp(namespace, { version: seed.version, driveId });
    mark("seeded");
  } else if (driveId) {
    // A return visit. The index store is relaxed (fast writes, flushed a moment
    // later), so a reload can overtake its last rows: rebuild it from the
    // documents rather than trust it.
    onProgress?.("index");
    await knowledgeGraph.reindex(driveId);
    mark("reindexed");
    const current = await options.loadSeed().then((s) => s.version).catch(() => null);
    outdated = Boolean(stamp && current && stamp.version !== current);
  }
  if (!driveId) throw new Error("The browser vault could not be created.");
  const vaultDriveId = driveId;

  const core = createCoreGraphQLService(client, models);
  const rest = createRestService(subgraph, `${LOCAL_ORIGIN}/api/@powerhousedao/knowledge-note`);
  const uninstallOrigin = installLocalOrigin(LOCAL_ORIGIN, {
    knowledgeGraph: (body) => knowledgeGraph.execute(body),
    core: (body) => core.execute(body),
    rest,
  });
  setHostConfig({
    kind: "browser",
    switchboardOrigin: LOCAL_ORIGIN,
    documents: hostDocuments(client, models),
  });

  ensurePHEventHandlers();
  setVetraPackageManager(new StaticPackageManager([vaultLibrary]));
  setReactorClient(client as never);
  setDocumentCache(new DocumentCache(client as never));
  const publishDrive = async () => {
    const drive = await client.get<DocumentDriveDocument>(vaultDriveId);
    setDrives([drive]);
    return drive;
  };
  // The vault writes its own URLs (/d/<drive>/<node>); keep them under the page's path, and
  // reopen what a reloaded or shared URL names.
  const basePath = options.basePath ?? "/";
  setPHGlobalConfig({ basePath });
  const drive = await publishDrive();
  const below = window.location.pathname.startsWith(basePath)
    ? `/${window.location.pathname.slice(basePath.length)}`
    : window.location.pathname;
  if (below.startsWith("/d/")) syncSelectionFromPath(window.location.pathname);
  else setSelectedDrive(drive);

  let pending: ReturnType<typeof setTimeout> | undefined;
  const stopFeed = startLiveFeed(client, vaultDriveId, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void publishDrive().catch(() => undefined), 150);
  });

  // Ask the browser not to evict the vault; older browsers have no storage manager.
  if ("storage" in navigator && typeof navigator.storage.persist === "function") {
    void navigator.storage.persist().catch(() => undefined);
  }
  onProgress?.("ready");
  mark("ready");
  console.info(`[BrowserVault] ready: ${JSON.stringify(timings)} (ms since start)`);

  return {
    engine,
    driveId: vaultDriveId,
    outdated,
    stop: async () => {
      if (pending) clearTimeout(pending);
      stopFeed();
      uninstallOrigin();
      setHostConfig(undefined);
      await engine.close();
    },
  };
}

/** Delete the browser vault (engine stores and seed stamp). The page reloads into a fresh one. */
export async function deleteBrowserVault(namespace: string, booted?: BootedVault): Promise<void> {
  await booted?.stop();
  try {
    localStorage.removeItem(stampKey(namespace));
  } catch {
    // Nothing to remove.
  }
  await Promise.all(
    engineDatabases(namespace).map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }),
    ),
  );
}
