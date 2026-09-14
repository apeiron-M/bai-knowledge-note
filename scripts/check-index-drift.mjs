#!/usr/bin/env node
/**
 * Compare the graph index against the drive it projects.
 *
 * The graph-indexer is a live processor: it sees each operation as it happens,
 * so under normal use the projection cannot fall behind. Two things break that
 * assumption, and neither heals on its own:
 *
 *   1. The projection is built by the indexer's CODE. Ship a change to what it
 *      projects and every existing row was written by the old version.
 *   2. The processor cursor advances past history and never revisits it
 *      (see processors/graph-indexer/index.ts, initAndUpgrade). Only embeddings
 *      are backfilled at boot — nodes and edges are not. So an index that is
 *      missing, cleared or was stood up against an existing vault stays wrong
 *      through any number of restarts.
 *
 * Both are episodic, which is why this is a CHECK and not a schedule. Running
 * `admin/reindex` on a timer would rebuild every node and edge to reproduce
 * what the live path already did correctly — and the reactor executes one job
 * at a time, so each rebuild blocks every read for its duration.
 *
 *   node scripts/check-index-drift.mjs --drive <uuid> [--base <origin>]
 *
 * Falls back to GraphQL when the REST surface is not deployed — an older
 * Switchboard is exactly where drift is most likely, so the check has to work
 * there too.
 *
 * Exit 0 when the index matches, 1 when it has drifted. Reads only.
 */
const INDEXED_DOCUMENT_TYPES = new Set([
  "bai/knowledge-note",
  "bai/moc",
  "bai/research-claim",
  "bai/tension",
  "bai/observation",
  "powerhouse/scopeofwork",
  "bai/wbs",
]);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const drive = arg("drive");
if (!drive) {
  console.error("usage: node scripts/check-index-drift.mjs --drive <uuid> [--base <origin>]");
  process.exit(2);
}
const origin = arg("base", "http://localhost:4001");
const base = `${origin}/api/@powerhousedao/knowledge-note`;
const token = process.env.TOKEN ?? "";
const headers = token ? { authorization: `Bearer ${token}` } : {};

const get = async (path) => {
  let res;
  try {
    res = await fetch(`${base}${path}`, { headers });
  } catch (err) {
    // A stack trace here tells the reader nothing they can act on.
    console.error(`cannot reach ${origin} — is the reactor running? (${err.cause?.code ?? err.message})`);
    process.exit(2);
  }
  if (res.status === 401) {
    console.error("401 — set TOKEN (switchboard auth token), or the vault has auth on");
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`${path} -> ${res.status}`);
    process.exit(2);
  }
  return res.json();
};

const gql = async (query) => {
  const res = await fetch(`${origin}/graphql`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (body.errors) {
    console.error(`graphql: ${body.errors[0].message}`);
    process.exit(2);
  }
  return body.data;
};

// Prefer REST; fall back to GraphQL where the http subgraph is not deployed.
const probe = await fetch(`${base}/ping`, { headers }).catch(() => null);
const viaRest = probe !== null && probe.status !== 404;
if (!viaRest) console.log("note: REST surface not deployed here — using GraphQL");

let stats, edges;
if (viaRest) {
  const graph = await get(`/graph.json?drive=${drive}`);
  stats = await get(`/stats?drive=${drive}`);
  const nodeIds = new Set((graph.nodes ?? []).map((n) => n.documentId ?? n.id));
  edges = (graph.edges ?? []).map((e) => ({
    linkType: e.linkType,
    targetTitle: e.targetTitle,
    targetIndexed: nodeIds.has(e.targetDocumentId),
  }));
} else {
  const d = await gql(
    `{ knowledgeGraphStats(driveId:"${drive}"){ nodeCount edgeCount }
       knowledgeGraphNodes(driveId:"${drive}"){ documentId }
       knowledgeGraphEdges(driveId:"${drive}"){ linkType targetTitle targetDocumentId } }`,
  );
  stats = d.knowledgeGraphStats;
  const nodeIds = new Set(d.knowledgeGraphNodes.map((n) => n.documentId));
  edges = d.knowledgeGraphEdges.map((e) => ({
    linkType: e.linkType,
    targetTitle: e.targetTitle,
    targetIndexed: nodeIds.has(e.targetDocumentId),
  }));
}

const problems = [];

// Every edge whose target is an indexed node should carry that node's title.
// A null there means the row predates the backfill; reads then return bare
// UUIDs and every traversal costs an extra lookup per edge. Edges pointing at
// a NON-indexed document (DERIVED_FROM -> a source) are correctly null.
const untitled = edges.filter((e) => e.targetIndexed && !e.targetTitle);
if (untitled.length) {
  problems.push(
    `${untitled.length} edge(s) point at an indexed node but carry no title — the projection predates the edge-title backfill`,
  );
}

const missing = viaRest
  ? await get(`/embeddings/missing?drive=${drive}`)
  : (await gql(`{ knowledgeGraphMissingEmbeddings(driveId:"${drive}") }`))
      .knowledgeGraphMissingEmbeddings;
if (Array.isArray(missing) && missing.length) {
  // Not drift: the boot backfill fills these in. Report, do not fail.
  console.log(`note: ${missing.length} note(s) awaiting an embedding (the processor backfills these at boot)`);
}

console.log(`index:  ${stats.nodeCount} nodes, ${stats.edgeCount} knowledge edges`);
console.log(`edges:  ${edges.length} total, ${edges.filter((e) => !e.targetIndexed).length} pointing at non-indexed documents (correctly untitled)`);

if (problems.length === 0) {
  console.log("no drift detected");
  process.exit(0);
}
for (const p of problems) console.error(`DRIFT: ${p}`);

if (!viaRest) {
  // The edge-title backfill runs inside reindexDrive, and only the version
  // that also serves REST has it. On an older deployment a reindex replays
  // edges before their targets exist and writes NULL for every title — it
  // made a local vault 100% untitled. Do not send someone there.
  console.error(
    `\nDo NOT reindex this deployment yet: it predates the edge-title backfill,` +
      `\nand its reindex would null the titles on all ${edges.length} edges instead of fixing ${untitled.length}.` +
      `\nDeploy @powerhousedao/knowledge-note (a version serving /api/@powerhousedao/knowledge-note),` +
      `\nrestart the Switchboard, then reindex.`,
  );
} else {
  console.error(`\nrebuild with: POST ${base}/admin/reindex?drive=${drive}`);
}
process.exit(1);
