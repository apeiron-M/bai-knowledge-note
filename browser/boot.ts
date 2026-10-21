/**
 * Starting the browser vault: engine, seed, index, the page's Switchboard,
 * the host declaration and the `window.ph` slots the vault app reads.
 */
import type { IReactorClient } from "@powerhousedao/reactor";
import {
  DocumentCache,
  ensurePHEventHandlers,
  extractDriveSlugFromPath,
  findDriveBySlug,
  makeDriveSlug,
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
import { createBrowserEngine, engineDatabases, legacyIndexDatabase, type BrowserEngine } from "./engine.js";
import { writeHealthReport } from "./health.js";
import { createKnowledgeGraphService } from "./knowledge-graph.js";
import { startLiveFeed } from "./live-feed.js";
import { installLocalOrigin, LOCAL_ORIGIN } from "./local-origin.js";
import { createPageSubgraph } from "./page-subgraph.js";
import { createRestService } from "./rest.js";
import { redateSeed } from "./seed-dates.js";
import { seedContent, seedSkeleton, VAULT_APP_ID, type VaultSeed } from "./seed.js";

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
  /**
   * The guide's documents get new ids on a first visit (they follow the guide's new dates, see
   * seed-dates.ts): this maps the seed's id of a guide note, map or source to this vault's. Empty for a
   * vault seeded before the guide was dated to the visit.
   */
  guideIds: Readonly<Record<string, string>>;
  /**
   * On a first visit the vault app opens on the drive's skeleton while the
   * guide is written behind it: this settles once the guide is complete and on
   * disk, and is null when nothing is being written. Rejects if the guide could
   * not be written; nothing of the vault reached the disk then, so a reload
   * starts over.
   */
  seeding: Promise<void> | null;
  stop(): Promise<void>;
};

type SeedStamp = { version: string; driveId: string; ids?: Record<string, string> };

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

function deleteDatabases(names: readonly string[]): Promise<void> {
  return Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }),
    ),
  ).then(() => undefined);
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
  // The vault app is needed the moment the engine is up: fetch its code meanwhile.
  void import("../editors/knowledge-vault/editor.js").catch(() => undefined);

  const stamp = readStamp(namespace);
  // Without a stamp this is most likely a first visit: hold the store's flushes
  // from its very start (see FlushGate), so the guide reaches the disk in one write.
  const seedLoad = stamp ? null : options.loadSeed();
  seedLoad?.catch(() => undefined);
  onProgress?.("engine");
  const engine = await createBrowserEngine(namespace, { holdFlushes: !stamp });
  const { client, relationalDb, models } = engine;
  const subgraph = createPageSubgraph(client, relationalDb);
  const knowledgeGraph = createKnowledgeGraphService(subgraph);
  mark("engine");
  // The graph index's store from before it moved to memory: nothing reads it any more.
  void deleteDatabases([legacyIndexDatabase(namespace)]);

  let driveId = await findVaultDrive(client, stamp?.driveId);
  let outdated = false;
  let guideIds: Readonly<Record<string, string>> = stamp?.ids ?? {};
  let seed: VaultSeed | null = null;
  if (driveId) {
    // A return visit. Flushes held on a guess are let go: nothing of the vault was skipped.
    await engine.flushes.release();
    onProgress?.("index");
    const current = options.loadSeed().then((s) => s.version).catch(() => null);
    // The index lives in memory, so every start rebuilds it from the documents.
    await knowledgeGraph.reindex(driveId);
    mark("reindexed");
    const version = await current;
    outdated = Boolean(stamp && version && stamp.version !== version);
  } else {
    // Held until the guide is complete: nothing of the vault reaches the disk
    // before it is whole, so a tab closed halfway leaves nothing behind to repair.
    engine.flushes.hold();
    // Dated to the visit: the guide reads as processed in the minutes before the vault opened.
    const dated = redateSeed(await (seedLoad ?? options.loadSeed()), new Date());
    seed = dated.seed;
    guideIds = dated.ids;
    onProgress?.("seed");
    driveId = await seedSkeleton(client, models, seed);
    mark("skeleton");
  }
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
  // reopen what a reloaded or shared URL names — when it names this vault's drive. A URL from
  // before a reset, from a reload while the guide was still being written (that vault never
  // reached the disk), or from someone else's vault names a drive that is not here: selected,
  // it left the app on "Opening your vault…" for good. It is pointed at this vault's drive
  // instead. Its document goes (it may not exist here); its query stays, and the address is
  // already the one the app would move to, so the app does not navigate and drop it: the chat's
  // OpenRouter sign-in returns with ?code, and a sign-in started while the guide was being
  // written comes back to a new vault.
  const basePath = options.basePath ?? "/";
  setPHGlobalConfig({ basePath });
  const drive = await publishDrive();
  const named = extractDriveSlugFromPath(window.location.pathname);
  if (named && !findDriveBySlug([drive], named)) {
    const here = `${basePath.replace(/\/$/, "")}/d/${makeDriveSlug(drive)}`;
    window.history.replaceState(window.history.state, "", `${here}${window.location.search}${window.location.hash}`);
  }
  if (named) syncSelectionFromPath(window.location.pathname);
  else setSelectedDrive(drive);

  let pending: ReturnType<typeof setTimeout> | undefined;
  const stopFeed = startLiveFeed(client, vaultDriveId, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void publishDrive().catch(() => undefined), 150);
  });

  // The rest of the guide, behind the open app: the live feed shows it arriving.
  const abort = new AbortController();
  const guide = seed;
  const seeding = guide
    ? (async () => {
        try {
          await seedContent(client, models, guide, vaultDriveId, abort.signal);
        } catch (error) {
          // Stopped (a reset, the page going away): not a failure to report.
          if (abort.signal.aborted) throw new DOMException("The vault stopped.", "AbortError");
          throw error;
        }
        // The guide's health report, in the same write as the guide. The graph is rebuilt from the
        // documents first: the indexer follows writes a moment behind, and a report read from it
        // straight away could miss the last links.
        try {
          await knowledgeGraph.reindex(vaultDriveId);
          await writeHealthReport({ client, knowledgeGraph, driveId: vaultDriveId });
        } catch (error) {
          console.warn("[BrowserVault] The guide's health report could not be written.", error);
        }
        mark("seeded");
        await engine.flushes.release();
        mark("stored");
        writeStamp(namespace, { version: guide.version, driveId: vaultDriveId, ids: { ...guideIds } });
        console.info(`[BrowserVault] guide written: ${JSON.stringify(timings)} (ms since start)`);
      })()
    : null;
  seeding?.catch((error: unknown) => {
    if (!abort.signal.aborted) console.error("[BrowserVault] The guide could not be written.", error);
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
    guideIds,
    seeding,
    stop: async () => {
      abort.abort();
      await seeding?.catch(() => undefined);
      if (pending) clearTimeout(pending);
      stopFeed();
      uninstallOrigin();
      // Still a browser host, without the engine's writes: the page never becomes Connect.
      // Cleared, the declaration let the vault app — mounted until a reset's reload —
      // wire its drive to a remote client for a Switchboard guessed from the page's
      // address: a WebSocket to localhost:4001 here, to switchboard.oskv.vetra.io on the site.
      setHostConfig({ kind: "browser", switchboardOrigin: LOCAL_ORIGIN });
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
  await deleteDatabases(engineDatabases(namespace));
}
