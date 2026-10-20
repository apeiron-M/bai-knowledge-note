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

export type SeedProgress = (done: number, total: number) => void;

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

/**
 * Write `seed` into a new drive and return the drive id, as one batch of jobs
 * the engine runs in dependency order:
 *
 * - one job per document: its creation, its seeded state, and its link to the
 *   drive. The graph indexer must see that link in the same batch as the
 *   state, or it does not know the document is the vault's;
 * - one job on the drive: the folder tree and a node per document;
 * - one job per document with outgoing links, after the documents it links.
 *
 * The graph indexer must already be registered: it builds nodes from live
 * operations only.
 */
export async function seedVault(
  client: IReactorClient,
  models: readonly DocumentModelModule[],
  seed: VaultSeed,
  onProgress?: SeedProgress,
): Promise<string> {
  const total = seed.documents.length + seed.relationships.length;
  onProgress?.(0, total);

  const drive = await client.drives.create({
    global: { name: seed.drive.name, icon: null },
    preferredEditor: VAULT_APP_ID,
  });
  const driveId = drive.header.id;
  const moduleFor = new Map(models.map((m) => [m.documentModel.global.id, m]));
  const jobs: ExecutionJob[] = [];
  const seeded = new Set<string>();

  for (const doc of seed.documents) {
    const module = moduleFor.get(doc.documentType);
    if (!module) {
      console.warn(`[BrowserVault] The seed holds a ${doc.documentType} this engine has no model for; skipped.`);
      continue;
    }
    const created = module.utils.createDocument({
      global: doc.state.global,
      local: doc.state.local ?? {},
    } as never) as PHDocument;
    const version = (created.state as { document?: { version?: number } }).document?.version ?? 0;
    jobs.push({
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
    });
    seeded.add(doc.id);
  }

  const files = seed.drive.nodes.filter((n) => n.kind === "file" && seeded.has(n.id));
  jobs.push({
    key: "tree",
    documentId: driveId,
    scope: "global",
    branch: "main",
    actions: [
      ...foldersParentFirst(seed.drive.nodes).map((f) =>
        addFolder({ id: f.id, name: f.name, parentFolder: f.parentFolder ?? undefined }),
      ),
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

  const bySource = new Map<string, VaultSeedRelationship[]>();
  for (const r of seed.relationships) {
    if (!seeded.has(r.sourceId) || !seeded.has(r.targetId)) continue;
    const list = bySource.get(r.sourceId) ?? [];
    list.push(r);
    bySource.set(r.sourceId, list);
  }
  for (const [sourceId, links] of bySource) {
    jobs.push({
      key: `links:${sourceId}`,
      documentId: sourceId,
      scope: "document",
      branch: "main",
      actions: links.map((l) =>
        addRelationshipAction(l.sourceId, l.targetId, l.relationshipType, l.metadata ?? undefined),
      ),
      dependsOn: [...new Set([sourceId, ...links.map((l) => l.targetId)])].map((id) => `doc:${id}`),
    });
  }

  await client.executeBatch({ jobs });
  onProgress?.(total, total);
  return driveId;
}
