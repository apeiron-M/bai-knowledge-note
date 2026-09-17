#!/usr/bin/env node
/**
 * audit-replay-drift.mjs — which documents will change state on their next write?
 *
 * The reactor rebuilds a document by replaying its operation history through the
 * CURRENT reducers when it writes; reads serve the last stored state. After a
 * reducer is tightened (an input becomes an enum, a transition is guarded), an
 * operation that was valid when it was recorded may be rejected on replay, and
 * the document's next write then materialises a different state — silently.
 * Observed 2026-09-17: a queue's three `PROCESS_SOURCE` tasks vanished on its
 * next write once ADD_TASK rejected unknown task types.
 *
 * This script does what the server does: for every document on a drive it
 * replays the global operations through the reducers in dist/ and compares the
 * result with the stored state. It writes nothing.
 *
 * Usage:
 *   node scripts/audit-replay-drift.mjs --drive <uuid-or-slug> [--origin http://localhost:4001] [--types bai/source,bai/moc] [--out drift.json] [--concurrency 6]
 * Needs `bun run build` first (replays through dist/node/document-models).
 * Auth: SWITCHBOARD_TOKEN, else `switchboard auth token`.
 * Exit 0 = no harmful drift, 2 = harmful drift found (details in --out), 1 = error.
 * Benign drift (replay only adds a field the stored state predates) is reported, not failed.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const ORIGIN = (opt("--origin", process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001")).replace(/\/$/, "");
const DRIVE = opt("--drive"); if (!DRIVE) { console.error("--drive is required"); process.exit(1); }
const TYPES = opt("--types") ? new Set(opt("--types").split(",")) : null;
const OUT = opt("--out", `drift-${DRIVE.slice(0, 8)}.json`);
const CONCURRENCY = Number(opt("--concurrency", "6"));
const TOKEN = process.env.SWITCHBOARD_TOKEN ?? execSync("switchboard auth token", { encoding: "utf8" }).trim();
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const models = await import("../dist/node/document-models/index.mjs");
const byType = new Map();
for (const m of Object.values(models)) { const id = m?.documentModel?.global?.id ?? m?.documentModel?.id; if (id && m.reducer && m.utils?.createDocument) byType.set(id, m); }

async function gql(query, variables, attempt = 1) {
  const r = await fetch(`${ORIGIN}/graphql`, { method: "POST", headers: H, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) {
    // a busy reactor answers "fetch failed" transiently; one retry after a pause
    if (attempt < 3 && JSON.stringify(j.errors).includes("fetch failed")) { await new Promise((res) => setTimeout(res, 1500 * attempt)); return gql(query, variables, attempt + 1); }
    throw new Error(JSON.stringify(j.errors).slice(0, 300));
  }
  return j.data;
}
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

const list = JSON.parse(execSync(`switchboard docs list --drive ${DRIVE} --format json`, { encoding: "utf8", maxBuffer: 1 << 28 }));
const docs = list.map((d) => ({ id: d.id ?? d.header?.id, type: d.documentType ?? d.header?.documentType, name: d.name ?? d.header?.name }))
  .filter((d) => byType.has(d.type) && (!TYPES || TYPES.has(d.type)));
console.log(`drive ${DRIVE} · ${docs.length} replayable documents (${[...new Set(docs.map((d) => d.type))].join(", ")})`);

const results = await pool(docs, CONCURRENCY, async (d) => {
  try {
    const data = await gql(`query($id: String!) { document(identifier: $id) { document { state operations(filter: {scopes: ["global"]}) { items { index error action { id type input scope timestampUtcMs } } } } } }`, { id: d.id });
    const doc = data.document.document; const stored = doc.state?.global ?? doc.state;
    const ops = doc.operations.items.sort((a, b) => a.index - b.index);
    const model = byType.get(d.type);
    let replayed = model.utils.createDocument();
    const newlyRejected = [];
    for (const op of ops) {
      const input = typeof op.action.input === "string" ? JSON.parse(op.action.input) : op.action.input;
      replayed = model.reducer(replayed, { id: op.action.id, type: op.action.type, input, scope: op.action.scope ?? "global", timestampUtcMs: op.action.timestampUtcMs });
      const err = replayed.operations.global.at(-1)?.error;
      if (err && !op.error) newlyRejected.push({ index: op.index, type: op.action.type, error: String(err).slice(0, 160) });
    }
    const rep = replayed.state.global;
    const diffKeys = [...new Set([...Object.keys(stored ?? {}), ...Object.keys(rep ?? {})])].filter((k) => canon(stored?.[k]) !== canon(rep?.[k]));
    return { ...d, ops: ops.length, newlyRejected, diffKeys, stored: diffKeys.length ? Object.fromEntries(diffKeys.map((k) => [k, stored?.[k]])) : undefined, replayed: diffKeys.length ? Object.fromEntries(diffKeys.map((k) => [k, rep?.[k]])) : undefined };
  } catch (e) { return { ...d, failed: String(e.message).slice(0, 200) }; }
});

// Benign drift: replay only ADDS information the stored state lacked — a field
// introduced after the document was written (knowledge-note.updatedAt), or
// source provenance that the old reducer dropped (method/tool alone). Nothing
// the stored state asserts is lost. Everything else is harmful: a value the
// stored state has that the next write will not reproduce.
const isBenign = (r) => r.diffKeys.every((k) => {
  const s = r.stored?.[k], p = r.replayed?.[k];
  if (r.type === "bai/knowledge-note" && k === "updatedAt") return s == null && p != null;
  // provenance differing only in updatedAt: the old reducer overwrote it with createdAt; replay yields the real last edit
  if (r.type === "bai/knowledge-note" && k === "provenance") return !!s && !!p && ["author", "sourceOrigin", "sessionId", "createdAt"].every((f) => (s[f] ?? null) === (p[f] ?? null));
  if (r.type === "bai/source" && k === "provenance") return s == null || (p && Object.entries(s).every(([kk, vv]) => vv == null || p[kk] === vv));
  return false;
});
const allDrift = results.filter((r) => r.diffKeys?.length);
const benign = allDrift.filter(isBenign);
const drift = allDrift.filter((r) => !isBenign(r));
const rejectedOnly = results.filter((r) => !r.diffKeys?.length && r.newlyRejected?.length);
const failed = results.filter((r) => r.failed);
const byT = (rows) => rows.reduce((a, r) => ((a[r.type] = (a[r.type] ?? 0) + 1), a), {});
console.log(`HARMFUL drift on next write (stored value the replay will not reproduce): ${drift.length}`, byT(drift));
console.log(`benign drift (replay only adds a newer field / dropped provenance): ${benign.length}`, byT(benign));
console.log(`newly-rejected ops but same final state: ${rejectedOnly.length}`, byT(rejectedOnly));
if (failed.length) console.log(`failed to fetch/replay: ${failed.length}`, failed.slice(0, 3).map((f) => `${f.id} ${f.failed}`));
const errTally = {};
for (const r of [...drift, ...rejectedOnly]) for (const o of r.newlyRejected) { const k = `${r.type} ${o.type}: ${o.error.split(";")[0].slice(0, 70)}`; errTally[k] = (errTally[k] ?? 0) + 1; }
console.log("rejected-on-replay operations:"); for (const [k, v] of Object.entries(errTally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
for (const r of drift.slice(0, 40)) console.log(`  DRIFT ${r.type} ${r.id} ${(r.name ?? "").slice(0, 40)} keys=${r.diffKeys.join(",")} rejected=${r.newlyRejected.map((o) => o.type).join(",")}`);
if (drift.length > 40) console.log(`  … ${drift.length - 40} more in ${OUT}`);
writeFileSync(OUT, JSON.stringify({ drive: DRIVE, at: new Date().toISOString(), drift, benign, rejectedOnly, failed }, null, 1));
console.log(`written ${OUT}`);
process.exit(drift.length ? 2 : 0);
