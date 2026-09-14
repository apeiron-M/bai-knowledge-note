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

const [stats, graph] = await Promise.all([
  get(`/stats?drive=${drive}`),
  get(`/graph.json?drive=${drive}`),
]);

// What the drive says should be indexed.
const drives = await get("/drives");
const driveInfo = drives.drives?.find((d) => d.id === drive);
if (!driveInfo) {
  console.error(`drive ${drive} not found, or not readable`);
  process.exit(2);
}

const problems = [];

// Every edge whose target is an indexed node should carry that node's title.
// A null there means the row predates the backfill; reads then return bare
// UUIDs and every traversal costs an extra lookup per edge.
const nodeIds = new Set((graph.nodes ?? []).map((n) => n.documentId ?? n.id));
const untitled = (graph.edges ?? []).filter(
  (e) => nodeIds.has(e.targetDocumentId) && !e.targetTitle,
);
if (untitled.length) {
  problems.push(
    `${untitled.length} edge(s) point at an indexed node but carry no title — the projection predates the edge-title backfill`,
  );
}

const missing = await get(`/embeddings/missing?drive=${drive}`);
if (Array.isArray(missing) && missing.length) {
  // Not drift: the boot backfill fills these in. Report, do not fail.
  console.log(`note: ${missing.length} note(s) awaiting an embedding (the processor backfills these at boot)`);
}

console.log(`index:  ${stats.nodeCount} nodes, ${stats.edgeCount} edges`);
console.log(`drive:  ${driveInfo.nodes} nodes total (folders and non-indexed types included)`);

if (problems.length === 0) {
  console.log("no drift detected");
  process.exit(0);
}
for (const p of problems) console.error(`DRIFT: ${p}`);
console.error(`\nrebuild with: POST ${base}/admin/reindex?drive=${drive}`);
process.exit(1);
