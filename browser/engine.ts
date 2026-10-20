/**
 * The vault's engine, in the page: a Powerhouse reactor on PGlite (IndexedDB),
 * signing as an anonymous `did:key`, with the graph indexer registered as a
 * processor on a second, relational PGlite.
 *
 * This is the shape Connect builds in its in-process mode (`createBrowserReactor`
 * and `createProcessorHostModule`), which it does not export, reduced to what a
 * single vault needs: no sync channels, no package registry, no workers.
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

/** The app name the visitor's anonymous key signs as. */
const SIGNER_APP = "knowledge-vault-web";

export type BrowserEngine = {
  client: IReactorClient;
  relationalDb: IRelationalDb;
  /** Every document model the engine knows: the drive, then the vault's. */
  models: readonly DocumentModelModule[];
  /** The visitor's signing key, as a `did:key`. */
  did: string;
  close(): Promise<void>;
};

/** IndexedDB database names, so a reset can find them. */
export function engineDatabases(namespace: string): string[] {
  return [`/pglite/${namespace}-reactor`, `/pglite/${namespace}-relational`];
}

export async function createBrowserEngine(
  namespace: string,
): Promise<BrowserEngine> {
  // Durable on purpose: the reactor's group commit flushes through syncToFs,
  // which a relaxed instance resolves before the sync has run.
  const reactorPg = new PGlite(`idb://${namespace}-reactor`);
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

  // Relaxed: the index is rebuilt from the documents when it falls behind,
  // so a write that a reload overtakes costs a rebuild, not data.
  const relationalPg = new PGlite(`idb://${namespace}-relational`, {
    relaxedDurability: true,
  });
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
    close: async () => {
      await Promise.allSettled([reactorPg.close(), relationalPg.close()]);
    },
  };
}
