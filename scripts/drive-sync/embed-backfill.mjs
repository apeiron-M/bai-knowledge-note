// Headless embedding backfill — LEGACY ops tool.
//
// The graph-indexer processor now embeds server-side: on every content change
// and via a hash-gated backfill sweep on boot. On any reactor running that
// code this script is unnecessary — start the server and watch
// knowledgeGraphMissingEmbeddings drain instead. Keep it for older
// deployments, or to force-push vectors when the server's embedder is
// unavailable. It must use the same model as the server (gte-small q8) or
// search will silently mix incompatible vector spaces.
//
// The knowledge-graph subgraph stores and searches embeddings but never
// computes them; vectors are pushed by clients via the
// knowledgeGraphUpsertEmbedding mutation (normally by the Connect
// drive-app when someone opens the vault). After a headless upload.py
// run, semantic queries return nothing until this backfill runs.
//
// Embeds `title + " " + description` per node with Supabase/gte-small
// (q8, 384-dim) — the same model and quantization the browser uses, so
// vectors are interchangeable. The model is downloaded from the
// Hugging Face hub on first run and cached locally.
//
// Usage (from the repo root, reactor running):
//   bun scripts/drive-sync/embed-backfill.mjs --drive <drive-uuid-or-slug>
//   bun scripts/drive-sync/embed-backfill.mjs --drive my-knowledge \
//     --endpoint http://localhost:4001/graphql

function parseArgs(argv) {
  const args = { endpoint: "http://localhost:4001/graphql", drive: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--drive") args.drive = argv[++i];
    else if (argv[i] === "--endpoint") args.endpoint = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "usage: bun scripts/drive-sync/embed-backfill.mjs --drive <uuid-or-slug> [--endpoint <graphql-url>]",
      );
      process.exit(0);
    }
  }
  if (!args.drive) {
    console.error("error: --drive <uuid-or-slug> is required");
    process.exit(1);
  }
  return args;
}

async function gql(endpoint, query, variables) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const { endpoint, drive } = parseArgs(process.argv);

const missingData = await gql(
  endpoint,
  `query($driveId: ID!) { knowledgeGraphMissingEmbeddings(driveId: $driveId) }`,
  { driveId: drive },
);
const missing = missingData.knowledgeGraphMissingEmbeddings;
console.log(`[embed-backfill] missing embeddings: ${missing.length}`);
if (missing.length === 0) process.exit(0);

const nodesData = await gql(
  endpoint,
  `query($driveId: ID!) { knowledgeGraphNodes(driveId: $driveId) { documentId title description } }`,
  { driveId: drive },
);
const byId = new Map(
  nodesData.knowledgeGraphNodes.map((n) => [n.documentId, n]),
);

// Plain hub-download path: the custom CDN asset routing in
// processors/graph-indexer/embedder.ts is only needed inside the
// deployed browser bundle.
const { pipeline } = await import("@huggingface/transformers");
console.log("[embed-backfill] loading Supabase/gte-small (q8)…");
const extractor = await pipeline("feature-extraction", "Supabase/gte-small", {
  dtype: "q8",
});

let done = 0;
let skipped = 0;
for (const id of missing) {
  const meta = byId.get(id);
  const text = [meta?.title, meta?.description]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) {
    skipped++;
    continue;
  }
  const output = await extractor(text, { pooling: "mean", normalize: true });
  const embedding = Array.from(output.data);
  await gql(
    endpoint,
    `mutation($driveId: ID!, $documentId: ID!, $embedding: [Float!]!) {
       knowledgeGraphUpsertEmbedding(driveId: $driveId, documentId: $documentId, embedding: $embedding) { ok }
     }`,
    { driveId: drive, documentId: id, embedding },
  );
  done++;
  if (done % 50 === 0)
    console.log(`[embed-backfill] embedded ${done}/${missing.length}`);
}
console.log(
  `[embed-backfill] done — ${done} embedded, ${skipped} skipped (no text)`,
);
