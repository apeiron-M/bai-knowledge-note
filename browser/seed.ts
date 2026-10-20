/**
 * The vault a visitor starts with, written through the in-page engine on their
 * first visit. Built from an exported vault by `scripts/build-browser-seed.mjs`.
 *
 * Documents keep the ids they had in the vault they were exported from, so the
 * links between them and every reference inside their state (a source's
 * extracted claims, a map's members) stay valid without rewriting. A
 * content-addressed (v2) id is derived from the document type, its creation
 * time, a nonce and its protocol versions — not from a key — so the seed carries
 * those and the visitor's own key can recreate each document under its id.
 */
import {
  addRelationshipAction,
  createDocumentAction,
  upgradeDocumentAction,
  type IReactorClient,
} from "@powerhousedao/reactor";
import { addFile, addFolder } from "@powerhousedao/shared/document-drive";
import type { Action, DocumentModelModule, PHDocument } from "document-model";

export type VaultSeedNode = {
  id: string;
  kind: "folder" | "file";
  name: string;
  parentFolder: string | null;
  documentType?: string;
};

export type VaultSeedDocument = {
  id: string;
  name: string;
  documentType: string;
  state: { global: unknown; local?: unknown };
  /** What the id is derived from, as the original CREATE_DOCUMENT recorded it. */
  created: {
    createdAtUtcIso: string;
    nonce: string;
    protocolVersions: Record<string, number>;
  };
};

export type VaultSeedRelationship = {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  metadata?: Record<string, unknown> | null;
};

export type VaultSeed = {
  /** Changes whenever the content changes; a vault seeded from another version is offered a reset. */
  version: string;
  drive: { name: string; nodes: VaultSeedNode[] };
  documents: VaultSeedDocument[];
  relationships: VaultSeedRelationship[];
};

/** The drive app every seeded vault opens in. */
export const VAULT_APP_ID = "knowledge-vault";

/**
 * What the vault app must find when it opens, written with the folders before
 * it does:
 *
 * - the documents it creates itself on a drive without them (`useDriveInit`),
 *   or it would make a second set;
 * - the sources. A vault with no notes and no sources is new to the app
 *   (DriveExplorer's empty-vault landing), so it would leave Ask for the
 *   Sources intake ("Add your first sources") and stay there after the guide
 *   arrived. With the guide's source in place it opens on Ask.
 */
const SKELETON_TYPES: ReadonlySet<string> = new Set([
  "bai/vault-config",
  "bai/pipeline-queue",
  "bai/health-report",
  "bai/source",
]);

type ExecutionJob = {
  key: string;
  documentId: string;
  scope: string;
  branch: string;
  actions: Action[];
  dependsOn: string[];
};

/** Folders in an order where every parent comes before its children. */
function foldersParentFirst(nodes: readonly VaultSeedNode[]): VaultSeedNode[] {
  const folders = nodes.filter((n) => n.kind === "folder");
  const placed = new Set<string>();
  const ordered: VaultSeedNode[] = [];
  while (ordered.length < folders.length) {
    const before = ordered.length;
    for (const folder of folders) {
      if (placed.has(folder.id)) continue;
      if (folder.parentFolder && !placed.has(folder.parentFolder)) continue;
      placed.add(folder.id);
      ordered.push(folder);
    }
    if (ordered.length === before) break; // a cycle or a missing parent: stop rather than loop
  }
  return ordered;
}

type Writable = { doc: VaultSeedDocument; module: DocumentModelModule };

/** The seed's documents with the model that writes each; one without a model is skipped, with a warning. */
function writableDocuments(models: readonly DocumentModelModule[], seed: VaultSeed): Writable[] {
  const moduleFor = new Map(models.map((m) => [m.documentModel.global.id, m]));
  const writable: Writable[] = [];
  for (const doc of seed.documents) {
    const module = moduleFor.get(doc.documentType);
    if (module) writable.push({ doc, module });
    else console.warn(`[BrowserVault] The seed holds a ${doc.documentType} this engine has no model for; skipped.`);
  }
  return writable;
}

/**
 * One job per document: its creation under its seeded id, its seeded state,
 * and its link to the drive. The graph indexer must see that link in the same
 * batch as the state, or it does not know the document is the vault's.
 */
function documentJob(module: DocumentModelModule, doc: VaultSeedDocument, driveId: string): ExecutionJob {
  const created = module.utils.createDocument({
    global: doc.state.global,
    local: doc.state.local ?? {},
  } as never) as PHDocument;
  const version = (created.state as { document?: { version?: number } }).document?.version ?? 0;
  return {
    key: `doc:${doc.id}`,
    documentId: doc.id,
    scope: "document",
    branch: "main",
    actions: [
      createDocumentAction({
        model: doc.documentType,
        version: 0,
        documentId: doc.id,
        signing: {
          signature: doc.id,
          publicKey: created.header.sig.publicKey,
          nonce: doc.created.nonce,
          createdAtUtcIso: doc.created.createdAtUtcIso,
          documentType: doc.documentType,
        },
        slug: doc.id,
        name: doc.name,
        branch: "main",
        meta: created.header.meta,
        protocolVersions: doc.created.protocolVersions,
      }),
      upgradeDocumentAction({
        documentId: doc.id,
        model: doc.documentType,
        fromVersion: 0,
        toVersion: version,
        initialState: created.state,
      }),
      addRelationshipAction(driveId, doc.id, "child"),
    ],
    dependsOn: [],
  };
}

/** Jobs for `docs`, and a job on the drive that files them (and, with `folders`, makes the folders first). */
function placementJobs(seed: VaultSeed, docs: readonly Writable[], driveId: string, folders: boolean): ExecutionJob[] {
  const jobs = docs.map(({ doc, module }) => documentJob(module, doc, driveId));
  const ids = new Set(docs.map(({ doc }) => doc.id));
  const files = seed.drive.nodes.filter((n) => n.kind === "file" && ids.has(n.id));
  jobs.push({
    key: "tree",
    documentId: driveId,
    scope: "global",
    branch: "main",
    actions: [
      ...(folders
        ? foldersParentFirst(seed.drive.nodes).map((f) =>
            addFolder({ id: f.id, name: f.name, parentFolder: f.parentFolder ?? undefined }),
          )
        : []),
      ...files.map((f) =>
        addFile({
          id: f.id,
          name: f.name,
          documentType: f.documentType ?? "",
          parentFolder: f.parentFolder ?? undefined,
        }),
      ),
    ] as Action[],
    dependsOn: files.map((f) => `doc:${f.id}`),
  });
  return jobs;
}

/**
 * Write the part of the seed the vault app must find when it opens — a new
 * drive, its folders, the documents the app would otherwise create itself, and
 * the sources (see `SKELETON_TYPES`) — and return the drive id. Small on
 * purpose: the app opens as soon as it is written, and {@link seedContent}
 * fills the vault in behind it.
 *
 * The graph indexer must already be registered: it builds nodes from live
 * operations only.
 */
export async function seedSkeleton(
  client: IReactorClient,
  models: readonly DocumentModelModule[],
  seed: VaultSeed,
  signal?: AbortSignal,
): Promise<string> {
  const drive = await client.drives.create(
    { global: { name: seed.drive.name, icon: null }, preferredEditor: VAULT_APP_ID },
    signal,
  );
  const driveId = drive.header.id;
  const docs = writableDocuments(models, seed).filter(({ doc }) => SKELETON_TYPES.has(doc.documentType));
  await client.executeBatch({ jobs: placementJobs(seed, docs, driveId, true) }, signal);
  return driveId;
}

/**
 * Write the rest of the seed into the drive {@link seedSkeleton} made: the
 * notes and maps, their places in the folders, and — once both ends exist —
 * the links between documents, one job per document that has any.
 */
export async function seedContent(
  client: IReactorClient,
  models: readonly DocumentModelModule[],
  seed: VaultSeed,
  driveId: string,
  signal?: AbortSignal,
): Promise<void> {
  const writable = writableDocuments(models, seed);
  const docs = writable.filter(({ doc }) => !SKELETON_TYPES.has(doc.documentType));
  const jobs = placementJobs(seed, docs, driveId, false);

  const exists = new Set(writable.map(({ doc }) => doc.id));
  const inThisBatch = new Set(docs.map(({ doc }) => doc.id));
  const bySource = new Map<string, VaultSeedRelationship[]>();
  for (const r of seed.relationships) {
    if (!exists.has(r.sourceId) || !exists.has(r.targetId)) continue;
    const list = bySource.get(r.sourceId) ?? [];
    list.push(r);
    bySource.set(r.sourceId, list);
  }
  for (const [sourceId, links] of bySource) {
    // Documents the skeleton wrote are already there: only this batch's are waited for.
    const waitFor = [...new Set([sourceId, ...links.map((l) => l.targetId)])].filter((id) => inThisBatch.has(id));
    jobs.push({
      key: `links:${sourceId}`,
      documentId: sourceId,
      scope: "document",
      branch: "main",
      actions: links.map((l) =>
        addRelationshipAction(l.sourceId, l.targetId, l.relationshipType, l.metadata ?? undefined),
      ),
      dependsOn: waitFor.map((id) => `doc:${id}`),
    });
  }
  await client.executeBatch({ jobs }, signal);
}
