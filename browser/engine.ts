/**
 * The vault's engine, in the page: a Powerhouse reactor on PGlite (IndexedDB),
 * signing as an anonymous `did:key`, with the graph indexer registered as a
 * processor on a second, relational PGlite.
 *
 * This is the shape Connect builds in its in-process mode (`createBrowserReactor`
 * and `createProcessorHostModule`), which it does not export, reduced to what a
 * single vault needs: no sync channels, no package registry, no workers.
 *
 * Only the documents are kept in IndexedDB. The graph index lives in memory and
 * is rebuilt from them on every start: keeping it on disk cost a first visit
 * ~70 MB of IndexedDB writes and saved nothing, since a reload could overtake
 * its last rows and it was rebuilt anyway.
 */
import { PGlite } from "@electric-sql/pglite";
import {
  createReactorHostModuleBase,
  HardenedPGliteDialect,
  PGLITE_IDB_STORAGE_FACTS,
  type GroupCommitPGliteInstance,
  type IReactorClient,
} from "@powerhousedao/reactor";
import {
  ReactorBuilder,
  ReactorClientBuilder,
  type IProcessorHostModule,
} from "@powerhousedao/reactor-browser";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import {
  createRelationalDb,
  type IRelationalDb,
} from "@powerhousedao/shared/processors";
import {
  BrowserKeyStorage,
  RenownCryptoBuilder,
  RenownCryptoSigner,
} from "@renown/sdk";
import type { DocumentModelModule, PHDocumentHeader } from "document-model";
import { Kysely } from "kysely";
import { documentModels } from "../document-models/document-models.js";
import { graphIndexerFactoryBuilder } from "../processors/graph-indexer/factory.js";
import { gateFlushes, type FlushGate } from "./flush-gate.js";

export type { FlushGate } from "./flush-gate.js";

/** The app name the visitor's anonymous key signs as. */
const SIGNER_APP = "knowledge-vault-web";

/** How long a close waits for the reactor's active jobs before closing the stores anyway. */
const CLOSE_WAIT_MS = 5000;
/** How long the store must stay out of a transaction before a close goes ahead. */
const CLOSE_QUIET_MS = 150;

export type BrowserEngine = {
  client: IReactorClient;
  relationalDb: IRelationalDb;
  /** Every document model the engine knows: the drive, then the vault's. */
  models: readonly DocumentModelModule[];
  /** The visitor's signing key, as a `did:key`. */
  did: string;
  /** Holds the document store's writes to IndexedDB; see {@link FlushGate}. */
  flushes: FlushGate;
  close(): Promise<void>;
};

export type BrowserEngineOptions = {
  /** Start with the store's flushes held, PGlite's own start-up flush included. */
  holdFlushes?: boolean;
};

/** Where the graph index was kept before it moved to memory; deleted when found. */
export function legacyIndexDatabase(namespace: string): string {
  return `/pglite/${namespace}-relational`;
}

/** IndexedDB database names, so a reset can find them. */
export function engineDatabases(namespace: string): string[] {
  return [`/pglite/${namespace}-reactor`, legacyIndexDatabase(namespace)];
}

export async function createBrowserEngine(
  namespace: string,
  options: BrowserEngineOptions = {},
): Promise<BrowserEngine> {
  // Durable on purpose: the reactor's group commit flushes through syncToFs,
  // which a relaxed instance resolves before the sync has run.
  const reactorPg = new PGlite(`idb://${namespace}-reactor`);
  const flushes = gateFlushes(reactorPg, options.holdFlushes ?? false);
  await reactorPg.waitReady;

  const crypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(await BrowserKeyStorage.create())
    .build();
  const signer = new RenownCryptoSigner(crypto, SIGNER_APP);

  const models: DocumentModelModule[] = [
    driveDocumentModelModule as unknown as DocumentModelModule,
    ...(documentModels as unknown as DocumentModelModule[]),
  ];

  const reactorBuilder = new ReactorBuilder()
    .withDocumentModelSources(models)
    .withGroupCommitPGlite({
      pg: reactorPg as unknown as GroupCommitPGliteInstance,
      onUnrecoverable: (error: unknown) => {
        console.error("[BrowserVault] The vault's store failed; reload the page.", error);
      },
      onDiagnostic: (message: string, error: unknown) => {
        console.error(`[BrowserVault] storage: ${message}`, error);
      },
    })
    .withStorageFacts(PGLITE_IDB_STORAGE_FACTS);

  const module = await new ReactorClientBuilder()
    .withSigner({ signer })
    .withReactorBuilder(reactorBuilder)
    .buildModule();
  const client = module.client;

  // In memory: the boot rebuilds the index from the documents (see the module note).
  const relationalPg = new PGlite();
  await relationalPg.waitReady;
  const relationalDb = createRelationalDb(
    new Kysely({
      dialect: new HardenedPGliteDialect(
        relationalPg as unknown as ConstructorParameters<typeof HardenedPGliteDialect>[0],
        {
          onPoisoned: () => {
            console.error("[BrowserVault] The graph index store failed; reload the page.");
          },
        },
      ),
    }),
  );

  const reactorModule = module.reactorModule;
  if (!reactorModule) throw new Error("The in-page engine started without a reactor module.");
  const host = createReactorHostModuleBase({
    client,
    readModels: reactorModule.readModelCoordinator.readModels,
    relationalDb,
    // The vault registers no analytics processor: leaving the store out keeps
    // Connect's analytics engine out of the page.
    analyticsStore: undefined as unknown as Parameters<typeof createReactorHostModuleBase>[0]["analyticsStore"],
    processorApp: "connect",
  }) as unknown as IProcessorHostModule;
  const buildProcessors = graphIndexerFactoryBuilder(host);
  await reactorModule.processorManager.registerFactory(
    "knowledge-vault-graph",
    (driveHeader: PHDocumentHeader) => buildProcessors(driveHeader),
  );

  return {
    client,
    relationalDb,
    models,
    did: crypto.did,
    flushes,
    close: async () => {
      // The reactor first: its jobs, read models and the graph indexer still write, and a store
      // closed under them fails every statement — the "PGlite is closed" storm a stop during
      // the guide's writing raised. kill() lets active jobs finish; bounded, so a wedged job
      // cannot hold a reset.
      const begun = performance.now();
      const stopped = module.reactor.kill().completed.catch(() => undefined);
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]);
      const killed = performance.now();
      // Work already under way still writes after kill() — the last job, a read-model batch that
      // starts a few milliseconds later. Closed between two statements of its transaction, the
      // store fails the rollback and the session recovery retries dozens of times. Close once the
      // store has been out of a transaction for a quiet spell, not at the first idle instant.
      let quietSince = performance.now();
      while (performance.now() - quietSince < CLOSE_QUIET_MS && performance.now() - killed < CLOSE_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (reactorPg.isInTransaction()) quietSince = performance.now();
      }
      console.debug(
        `[BrowserVault] stopping: reactor ${Math.round(killed - begun)} ms, until quiet ${Math.round(performance.now() - killed)} ms`,
      );
      // The group-commit store flushes (through the gate: held flushes stay unwritten) and closes.
      const store = reactorModule.groupCommitStorage;
      await Promise.allSettled([store ? store.close() : reactorPg.close(), relationalPg.close()]);
    },
  };
}
