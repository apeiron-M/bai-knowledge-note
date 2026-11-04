#!/usr/bin/env node
/**
 * Record a change-digest test fixture from a live vault — READ ONLY.
 *
 * The change digest (`processors/graph-indexer/changes.ts`) is a pure
 * function over operation rows plus a little graph context. Its tests run on
 * rows recorded from a real vault, so the numbers they check come from what
 * actually happened (spec 2026-11-04 §7, "Fixtures") rather than from rows
 * someone typed.
 *
 * What it reads (GraphQL queries only — no mutation, no REST write):
 *   - knowledgeGraphNodes / knowledgeGraphEdges / knowledgeGraphSources: the
 *     graph context (titles, types, topics, MoC tiers, edges and reasons);
 *   - the MoC named by --moc, its CORE_IDEA members (through CHILD_MOC), the
 *     notes that supersede a member, and the sources the members derive from;
 *   - each of those documents' operation log (`documentOperations`, global +
 *     document scope), turned into `graph_operations`-shaped rows.
 *
 * What it writes: one JSON file (--out) with
 *   { window, driveId, moc, rows, baseline, context }
 * where `rows` are the in-window operations and `baseline` the last
 * pre-window value of each tracked field per document.
 *
 * Usage:
 *   node scripts/record-changes-fixture.mjs \
 *     --endpoint https://switchboard.knowledge-vault.vetra.io/graphql \
 *     --drive c5893e1b-854b-49b1-b8aa-6b133ab87969 \
 *     --profile remote-powerhouse-knowledge \
 *     --moc "Data Processing and CQRS" \
 *     --since 2026-11-03T18:00:00Z --until 2026-11-04T00:00:00Z \
 *     --out tests/fixtures/changes/2026-11-03-processors.json
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const endpoint = arg("endpoint");
const drive = arg("drive");
const profile = arg("profile");
const mocTitle = arg("moc", "Data Processing and CQRS");
const since = new Date(arg("since")).toISOString();
const until = new Date(arg("until")).toISOString();
const out = arg("out");
if (!endpoint || !drive || !out) {
  console.error("usage: --endpoint <url> --drive <id> [--profile <p>] --since <iso> --until <iso> --out <file>");
  process.exit(2);
}

const token = profile
  ? execFileSync("switchboard", ["-p", profile, "auth", "token"], { encoding: "utf8" }).trim().split("\n").at(-1)
  : "";

async function gql(query, variables) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

/** The field a baseline row stands for; null for operations that are not tracked. */
function baselineField(type, input) {
  switch (type) {
    case "SET_TITLE":
      return "title";
    case "SET_DESCRIPTION":
    case "UPDATE_DESCRIPTION":
      return "description";
    case "SET_CONTENT":
    case "UPDATE_CLAIM_CONTENT":
      return "content";
    case "SET_METADATA_FIELD":
      return input?.field === "version" ? "version" : null;
    case "INGEST_SOURCE":
      return "source";
    default:
      return null;
  }
}

async function operationsOf(documentId, documentType) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const data = await gql(
      `query($f: OperationsFilterInput!, $p: PagingInput) {
        documentOperations(filter: $f, paging: $p) {
          items { index timestampUtcMs action { type scope input context { signer { user { address } } } } }
          hasNextPage cursor
        }
      }`,
      { f: { documentIdOrSlug: documentId, scopes: ["global", "document"] }, p: { limit: 500, ...(cursor ? { cursor } : {}) } },
    );
    const pageData = data.documentOperations;
    for (const op of pageData.items) {
      const input = op.action.input ?? {};
      // Relationship operations are recorded on the edge's source note, like the indexer does.
      rows.push({
        documentId,
        documentType,
        operationType: op.action.type,
        timestamp: new Date(op.timestampUtcMs).toISOString(),
        index: op.index,
        scope: op.action.scope,
        inputJson: JSON.stringify(input),
        signerAddress: op.action.context?.signer?.user?.address ?? null,
      });
    }
    if (!pageData.hasNextPage || !pageData.cursor) break;
    cursor = pageData.cursor;
  }
  return rows;
}

const [{ knowledgeGraphNodes: nodes }, { knowledgeGraphEdges: edges }, { knowledgeGraphSources: sources }] = await Promise.all([
  gql(`query($d: ID!) { knowledgeGraphNodes(driveId: $d) { documentId title documentType status noteType topics } }`, { d: drive }),
  gql(`query($d: ID!) { knowledgeGraphEdges(driveId: $d) { sourceDocumentId targetDocumentId linkType reason } }`, { d: drive }),
  gql(`query($d: ID!) { knowledgeGraphSources(driveId: $d) { documentId parentFolder title addedAt url } }`, { d: drive }),
]);

const nodeById = new Map(nodes.map((n) => [n.documentId, n]));
const sourceById = new Map(sources.map((s) => [s.documentId, s]));
const moc = nodes.find((n) => n.documentType === "bai/moc" && n.title === mocTitle);
if (!moc) throw new Error(`no MoC titled "${mocTitle}"`);

// The MoC, its child MoCs (recursively), and their CORE_IDEA members.
const mocs = new Set([moc.documentId]);
const queue = [moc.documentId];
while (queue.length) {
  const id = queue.shift();
  for (const e of edges) {
    if (e.sourceDocumentId === id && e.linkType === "CHILD_MOC" && !mocs.has(e.targetDocumentId)) {
      mocs.add(e.targetDocumentId);
      queue.push(e.targetDocumentId);
    }
  }
}
const members = new Set();
for (const e of edges) if (mocs.has(e.sourceDocumentId) && e.linkType === "CORE_IDEA") members.add(e.targetDocumentId);
// Notes that supersede a member: their SUPERSEDES row lives on them.
const superseders = new Set();
for (const e of edges) if (e.linkType === "SUPERSEDES" && members.has(e.targetDocumentId)) superseders.add(e.sourceDocumentId);
// Sources the members derive from.
const derivedFrom = new Map();
for (const e of edges) {
  if (e.linkType !== "DERIVED_FROM" || !members.has(e.sourceDocumentId)) continue;
  derivedFrom.set(e.sourceDocumentId, [...(derivedFrom.get(e.sourceDocumentId) ?? []), e.targetDocumentId]);
}
const memberSources = new Set([...derivedFrom.values()].flat().filter((id) => sourceById.has(id)));

const docs = [
  ...[...mocs, ...members, ...superseders].map((id) => [id, nodeById.get(id)?.documentType ?? "bai/knowledge-note"]),
  ...[...memberSources].map((id) => [id, "bai/source"]),
];
console.error(`MoC ${moc.documentId}: ${mocs.size} map(s), ${members.size} member(s), ${superseders.size} superseder(s), ${memberSources.size} source(s)`);

// Source claim lists, from each source's own state.
const claimIds = new Map();
for (const id of memberSources) {
  const data = await gql(`query($id: String!) { document(idOrSlug: $id) { document { state } } }`, { id });
  claimIds.set(id, data.document?.document?.state?.global?.extractedClaims ?? []);
}

const RECORDED_SOURCE_ACTIONS = new Set(["INGEST_SOURCE", "SET_SOURCE_STATUS", "ADD_EXTRACTED_CLAIM", "REMOVE_EXTRACTED_CLAIM", "RECORD_EXTRACTION_STATS"]);
const rows = [];
const baseline = [];
let n = 0;
for (const [id, type] of docs) {
  const all = (await operationsOf(id, type)).filter((r) => type !== "bai/source" || RECORDED_SOURCE_ACTIONS.has(r.operationType));
  if (++n % 10 === 0) console.error(`  ${n}/${docs.length} logs read`);
  // The last pre-window row per tracked field, plus content patches after the last full content.
  const last = new Map();
  const patches = [];
  for (const r of all) {
    if (r.timestamp >= since) continue;
    const input = JSON.parse(r.inputJson);
    const field = baselineField(r.operationType, input);
    if (field) {
      last.set(field, r);
      if (field === "content") patches.length = 0;
    } else if (r.operationType === "PATCH_CONTENT") patches.push(r);
  }
  baseline.push(...last.values(), ...patches);
  rows.push(...all.filter((r) => r.timestamp >= since && r.timestamp <= until));
}
const strip = ({ scope: _scope, ...r }) => r;

const mocsByNote = [];
for (const e of edges) {
  if (e.linkType !== "CORE_IDEA" || !members.has(e.targetDocumentId)) continue;
  const m = nodeById.get(e.sourceDocumentId);
  if (!m) continue;
  const tier = /MOC \((\w+)\)/.exec(m.noteType ?? "")?.[1] ?? "TOPIC";
  mocsByNote.push({ noteId: e.targetDocumentId, id: m.documentId, title: m.title, tier });
}

const ids = new Set(docs.map(([id]) => id));
const fixture = {
  recordedAt: new Date().toISOString(),
  endpoint,
  driveId: drive,
  window: { since, until },
  moc: { id: moc.documentId, title: moc.title },
  rows: rows.map(strip).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.documentId.localeCompare(b.documentId) || a.index - b.index),
  baseline: baseline.map(strip),
  context: {
    nodes: nodes
      .filter((x) => ids.has(x.documentId))
      .map((x) => ({ id: x.documentId, title: x.title ?? "", documentType: x.documentType, status: x.status, topics: x.topics })),
    sources: [...memberSources].map((id) => {
      const s = sourceById.get(id);
      return { id, title: s.title, folder: s.parentFolder ?? null, addedAt: s.addedAt, claimIds: claimIds.get(id) ?? [] };
    }),
    mocsByNote,
    derivedFrom: [...derivedFrom].map(([noteId, sourceIds]) => ({ noteId, sourceIds })),
    edges: edges
      .filter((e) => ids.has(e.sourceDocumentId) && e.reason && (e.linkType === "SUPERSEDES" || e.linkType === "DERIVED_FROM"))
      .map((e) => ({ source: e.sourceDocumentId, target: e.targetDocumentId, type: e.linkType, reason: e.reason })),
  },
};
writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
console.error(`wrote ${out}: ${fixture.rows.length} rows in window, ${fixture.baseline.length} baseline rows`);
