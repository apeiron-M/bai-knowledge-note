#!/usr/bin/env node
/**
 * reassert-drift.mjs — make a document's replayed state converge on its stored
 * state by dispatching legal NEW operations (last write wins).
 *
 * Input: the JSON written by audit-replay-drift.mjs. For every harmful
 * document it fetches the current stored state, computes the operations that
 * take the *replayed* state (what the server will materialise on write) to the
 * *stored* one along legal transitions, and dispatches them in one batch per
 * document through `POST actions`. It then re-reads the document and reports.
 *
 * What it knows how to re-assert:
 *   knowledge-note   noteType (SET_NOTE_TYPE); provenance author/sourceOrigin
 *                    (SET_PROVENANCE with the replayed createdAt — immutable);
 *                    closed-vocabulary metadata fields (SET_METADATA_FIELD)
 *   source           status — walked along the transition table from the
 *                    replayed status; extractionStats — re-recorded with
 *                    claimCount = extractedClaims.length, skippedCount kept,
 *                    skipRate recomputed, extractedAt/extractedBy kept
 *   observation      status — PROMOTE (stored promotedTo/At) / IMPLEMENT / ARCHIVE
 *   vault-config     dimensions / vocabulary / maintenance (enum keys)
 *   pipeline-queue   counters (RECONCILE_COUNTERS); tasks the replay drops are
 *                    REPORTED as lost — a task type that no longer exists
 *                    cannot be re-added, and faking one would be a lie
 * Anything else is reported as "no re-assert rule" and left alone.
 *
 * Usage:
 *   node scripts/reassert-drift.mjs --drift drift-<drive>.json [--origin http://localhost:4001] [--apply] [--concurrency 4]
 * Default is a DRY RUN. Auth: SWITCHBOARD_TOKEN, else `switchboard auth token`.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const APPLY = args.includes("--apply");
const ORIGIN = (opt("--origin", process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001")).replace(/\/$/, "");
const DRIFT = opt("--drift"); if (!DRIFT) { console.error("--drift <file> is required"); process.exit(1); }
const CONCURRENCY = Number(opt("--concurrency", "4"));
const TOKEN = process.env.SWITCHBOARD_TOKEN ?? execSync("switchboard auth token", { encoding: "utf8" }).trim();
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const drift = JSON.parse(readFileSync(DRIFT, "utf8"));
const DRIVE = drift.drive;
const BASE = `${ORIGIN}/api/@powerhousedao/knowledge-note`;
const now = () => new Date().toISOString();

async function getState(id) {
  const r = await fetch(`${BASE}/notes/${id}?drive=${DRIVE}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${id} → ${r.status}`); return (await r.json()).state.global;
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SOURCE_EDGES = { INBOX: ["EXTRACTING", "ARCHIVED"], EXTRACTING: ["EXTRACTED", "INBOX", "ARCHIVED"], EXTRACTED: ["ARCHIVED", "EXTRACTING"], ARCHIVED: ["INBOX"] };
function statusPath(from, to, edges) {
  if (from === to) return [];
  const prev = { [from]: null }; const q = [from];
  while (q.length) { const s = q.shift(); for (const n of edges[s] ?? []) if (!(n in prev)) { prev[n] = s; q.push(n); if (n === to) { const p = []; for (let c = to; c !== from; c = prev[c]) p.unshift(c); return p; } } }
  return null;
}
const DIM = { granularity: "GRANULARITY", organization: "ORGANIZATION", linking: "LINKING", processing: "PROCESSING", navigation: "NAVIGATION", maintenance: "MAINTENANCE", schema: "SCHEMA", automation: "AUTOMATION" };
const VOC = { notes: "NOTES", inbox: "INBOX", reduce: "REDUCE", reflect: "REFLECT", reweave: "REWEAVE", verify: "VERIFY", rethink: "RETHINK", topicMap: "TOPIC_MAP", description: "DESCRIPTION" };
const MNT = { orphanThreshold: "ORPHAN_THRESHOLD", danglingThreshold: "DANGLING_THRESHOLD", inboxPressure: "INBOX_PRESSURE", observationAccumulation: "OBSERVATION_ACCUMULATION", tensionAccumulation: "TENSION_ACCUMULATION", mocOversize: "MOC_OVERSIZE", staleNoteDays: "STALE_NOTE_DAYS" };
const VOCAB = { confidence: ["grounded", "established", "speculative"], severity: ["critical", "warning", "info"], decisionStatus: ["proposed", "accepted", "rejected", "superseded"] };

/** actions that take `replayed` to `stored`; `notes` collects what cannot be re-asserted */
function plan(r, stored, replayed, current) {
  const A = []; const notes = []; const t = now();
  const act = (type, input) => A.push({ type, scope: "global", input });
  for (const k of r.diffKeys) {
    const s = stored[k], p = replayed[k];
    if (r.type === "bai/knowledge-note") {
      if (k === "updatedAt") continue; // new field; replay populates it
      if (k === "noteType" && s) act("SET_NOTE_TYPE", { noteType: s, updatedAt: t });
      else if (k === "provenance") {
        if (!s) continue;
        const onlyTimestamp = p && s.author === p.author && s.sourceOrigin === p.sourceOrigin && (s.sessionId ?? null) === (p.sessionId ?? null) && s.createdAt === p.createdAt;
        if (onlyTimestamp) continue; // replay corrects updatedAt; nothing to assert
        act("SET_PROVENANCE", { author: s.author, sourceOrigin: s.sourceOrigin, ...(s.sessionId ? { sessionId: s.sessionId } : {}), createdAt: p?.createdAt ?? s.createdAt });
      } else if (k in VOCAB) { if (s && VOCAB[k].includes(s)) act("SET_METADATA_FIELD", { field: k, value: s, updatedAt: t }); else if (s) notes.push(`${k}="${s}" is outside the vocabulary; left null`); }
      else notes.push(`no re-assert rule for knowledge-note.${k}`);
    } else if (r.type === "bai/source") {
      if (k === "status") {
        const path = statusPath(p ?? "INBOX", s, SOURCE_EDGES);
        if (path) for (const st of path) act("SET_SOURCE_STATUS", { status: st }); else notes.push(`no legal path ${p} → ${s}`);
      } else if (k === "extractionStats") {
        if (!s) continue; // replay adds stats the stored state lacked — fine
        const refs = (current.extractedClaims ?? []).length; const skipped = s.skippedCount ?? 0;
        act("RECORD_EXTRACTION_STATS", { claimCount: refs, skippedCount: skipped, skipRate: refs + skipped ? skipped / (refs + skipped) : 0, extractedAt: s.extractedAt ?? t, ...(s.extractedBy ? { extractedBy: s.extractedBy } : {}) });
        if (s.claimCount !== refs) notes.push(`claimCount ${s.claimCount} → ${refs} (the claim list is the truth)`);
      } else if (k === "provenance") continue; // replay keeps method/tool the old reducer dropped
      else notes.push(`no re-assert rule for source.${k}`);
    } else if (r.type === "bai/observation" && k === "status") {
      const from = p ?? "PENDING";
      const chain = { PENDING: [], PROMOTED: ["PROMOTED"], IMPLEMENTED: ["PROMOTED", "IMPLEMENTED"], ARCHIVED: ["ARCHIVED"] }[s] ?? [];
      const idx = { PENDING: 0, PROMOTED: 1, IMPLEMENTED: 2 }[from] ?? 0;
      for (const st of chain.slice(s === "ARCHIVED" ? 0 : idx)) {
        if (st === "PROMOTED") act("PROMOTE_OBSERVATION", { promotedTo: stored.promotedTo ?? "unknown", promotedAt: stored.promotedAt ?? t });
        if (st === "IMPLEMENTED") act("IMPLEMENT_OBSERVATION", { updatedAt: t });
        if (st === "ARCHIVED") act("ARCHIVE_OBSERVATION", { updatedAt: t });
      }
    } else if (r.type === "bai/vault-config") {
      if (k === "dimensions" && s) for (const [key, v] of Object.entries(s)) if (!eq(v, p?.[key])) act("UPDATE_DIMENSION", { dimension: DIM[key], value: v.value, confidence: v.confidence, ...(v.rationale ? { rationale: v.rationale } : {}), updatedAt: t });
      else if (k === "vocabulary" && s) for (const [key, v] of Object.entries(s)) if (v !== p?.[key]) act("UPDATE_VOCABULARY", { key: VOC[key], value: v, updatedAt: t });
      else if (k === "maintenance" && s) for (const [key, v] of Object.entries(s)) if (v !== p?.[key]) act("UPDATE_MAINTENANCE_THRESHOLD", { condition: MNT[key], threshold: v, updatedAt: t });
      else if (k !== "updatedAt") notes.push(`no re-assert rule for vault-config.${k}`);
    } else if (r.type === "bai/pipeline-queue") {
      if (k === "tasks") { const lost = (s ?? []).filter((x) => !(p ?? []).some((y) => y.id === x.id)); notes.push(`LOST on replay: ${lost.length} task(s) ${lost.map((x) => `${x.id}(${x.taskType})`).join(" ")}`); }
      else if (k === "completedCount" || k === "activeCount") { if (!A.some((a) => a.type === "RECONCILE_COUNTERS")) act("RECONCILE_COUNTERS", { updatedAt: t }); }
      else if (k !== "lastProcessedAt") notes.push(`no re-assert rule for pipeline-queue.${k}`);
    } else notes.push(`no re-assert rule for ${r.type}.${k}`);
  }
  return { A, notes };
}

const harmful = drift.harmful ?? drift.drift ?? [];
console.log(`${APPLY ? "APPLY" : "DRY RUN"} · drive ${DRIVE} · ${harmful.length} harmful documents from ${DRIFT}`);
const plans = await pool(harmful, CONCURRENCY, async (r) => {
  try { const current = await getState(r.id); const { A, notes } = plan(r, r.stored ?? {}, r.replayed ?? {}, current); return { ...r, A, notes }; }
  catch (e) { return { ...r, A: [], notes: [`fetch failed: ${e.message}`] }; }
});
const tally = {};
for (const p of plans) for (const a of p.A) tally[`${p.type} ${a.type}`] = (tally[`${p.type} ${a.type}`] ?? 0) + 1;
console.log("planned operations:", tally);
const withNotes = plans.filter((p) => p.notes.length);
const noteTally = {};
for (const p of withNotes) for (const n of p.notes) noteTally[n.replace(/[0-9a-f-]{36}/g, "<id>").slice(0, 90)] = (noteTally[n.replace(/[0-9a-f-]{36}/g, "<id>").slice(0, 90)] ?? 0) + 1;
console.log("notes:", noteTally);
console.log(`documents with something to dispatch: ${plans.filter((p) => p.A.length).length} · nothing to do: ${plans.filter((p) => !p.A.length).length}`);
if (!APPLY) { console.log("dry run — nothing written. Re-run with --apply, then re-run the audit."); process.exit(0); }

const results = await pool(plans.filter((p) => p.A.length), CONCURRENCY, async (p) => {
  const r = await fetch(`${BASE}/actions`, { method: "POST", headers: H, body: JSON.stringify({ documentId: p.id, wait: true, actions: p.A }) });
  const j = await r.json().catch(() => ({}));
  const errs = (j.operations ?? []).filter((o) => o.error).map((o) => o.error);
  if (!r.ok) return { id: p.id, ok: false, why: `${r.status} ${j.error ?? ""}` };
  if (errs.length) return { id: p.id, ok: false, why: errs.join(" | ").slice(0, 200) };
  const after = await getState(p.id);
  const bad = p.diffKeys.filter((k) => !["updatedAt", "provenance", "lastProcessedAt", "tasks"].includes(k) && !eq(after[k], (p.stored ?? {})[k]) && !(k === "extractionStats"));
  return { id: p.id, ok: bad.length === 0, why: bad.length ? `still differs: ${bad.join(",")}` : "" };
});
const failed = results.filter((x) => !x.ok);
console.log(`dispatched and verified: ${results.length - failed.length}/${results.length}`);
for (const f of failed.slice(0, 20)) console.log(`  FAILED ${f.id}: ${f.why}`);
process.exit(failed.length ? 1 : 0);
