#!/usr/bin/env node
/**
 * Build the browser vault's starting content from a vault on any Switchboard.
 *
 *   node scripts/build-browser-seed.mjs --switchboard http://127.0.0.1:4201 --drive <drive-id> \
 *     [--out browser/seed/guide-vault.json]
 *
 * Read-only: it queries the drive, each of its documents and their outgoing
 * relationships, and writes the slim seed `browser/seed.ts` describes. The
 * version is a hash of the content, so a returning visitor's vault can tell it
 * was seeded from another version.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
if (!args.switchboard || !args.drive) {
  console.error("usage: build-browser-seed.mjs --switchboard <origin> --drive <drive-id> [--out <file>] [--token <bearer>]");
  process.exit(2);
}
const endpoint = `${args.switchboard.replace(/\/+$/, "")}/graphql/r`;
const out = resolve(args.out ?? "browser/seed/guide-vault.json");

async function gql(query, variables) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(args.token ? { authorization: `Bearer ${args.token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

const DOC = `query($id:String!){ document(idOrSlug:$id){ document { id name documentType state } } }`;
const CREATED = `query($id:String!){ documentOperations(filter:{documentIdOrSlug:$id, scopes:["document"], actionTypes:["CREATE_DOCUMENT"]}, paging:{limit:1}) {
  items { action { input } } } }`;
const RELS = `query($id:String!){ documentOutgoingRelationshipEdges(sourceIdOrSlug:$id, paging:{limit:1000}) {
  items { sourceId targetId relationshipType metadata } } }`;

const drive = (await gql(DOC, { id: args.drive })).document.document;
const nodes = drive.state.global.nodes.map((n) => ({
  id: n.id,
  kind: n.kind,
  name: n.name,
  parentFolder: n.parentFolder ?? null,
  ...(n.kind === "file" ? { documentType: n.documentType } : {}),
}));

const documents = [];
const relationships = [];
for (const node of nodes.filter((n) => n.kind === "file")) {
  const doc = (await gql(DOC, { id: node.id })).document.document;
  // A content-addressed id is derived from these; carrying them lets another key recreate the document under its id.
  const create = (await gql(CREATED, { id: node.id })).documentOperations.items[0]?.action.input;
  if (!create?.signing?.nonce || !create.protocolVersions) throw new Error(`${node.id}: no CREATE_DOCUMENT with signing params`);
  documents.push({
    id: doc.id,
    name: doc.name,
    documentType: doc.documentType,
    state: { global: doc.state.global, ...(doc.state.local ? { local: doc.state.local } : {}) },
    created: {
      createdAtUtcIso: create.signing.createdAtUtcIso,
      nonce: create.signing.nonce,
      protocolVersions: create.protocolVersions,
    },
  });
  const edges = (await gql(RELS, { id: node.id })).documentOutgoingRelationshipEdges.items;
  relationships.push(...edges);
}
const ids = new Set(documents.map((d) => d.id));
const kept = relationships
  .filter((r) => ids.has(r.sourceId) && ids.has(r.targetId))
  .map((r) => ({ sourceId: r.sourceId, targetId: r.targetId, relationshipType: r.relationshipType, metadata: r.metadata ?? null }));

const content = { drive: { name: drive.state.global.name || drive.name, nodes }, documents, relationships: kept };
const version = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 12);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ version, ...content }, null, 1)}\n`);

const types = {};
for (const d of documents) types[d.documentType] = (types[d.documentType] ?? 0) + 1;
console.log(`seed ${version}: ${documents.length} documents ${JSON.stringify(types)}, ${kept.length} links, ${nodes.filter((n) => n.kind === "folder").length} folders → ${out}`);
