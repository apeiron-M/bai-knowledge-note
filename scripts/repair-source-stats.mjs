#!/usr/bin/env node
/**
 * repair-source-stats.mjs — make every bai/source's extractionStats agree with
 * its extractedClaims list.
 *
 * RECORD_EXTRACTION_STATS now rejects `claimCount != extractedClaims.length`,
 * but stats recorded before that guard can disagree (a live drive had 50).
 * For each such source this re-records the stats with
 *   claimCount   = extractedClaims.length            (the list is the truth)
 *   skippedCount = unchanged
 *   skipRate     = skippedCount / (claimCount + skippedCount)   (0 when both are 0)
 *   extractedAt / extractedBy = unchanged
 * Sources with no stats at all are REPORTED, never touched: inventing a
 * skippedCount would be a lie the health report could not see through.
 *
 * Default is a DRY RUN. Usage:
 *   node scripts/repair-source-stats.mjs --drive <uuid> [--origin http://localhost:4001] [--apply]
 * Auth: SWITCHBOARD_TOKEN, else `switchboard auth token`.
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const APPLY = args.includes("--apply");
const ORIGIN = (opt("--origin", process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001")).replace(/\/$/, "");
const DRIVE = opt("--drive");
if (!DRIVE) { console.error("--drive <uuid> is required"); process.exit(1); }
const TOKEN = process.env.SWITCHBOARD_TOKEN ?? execSync("switchboard auth token", { encoding: "utf8" }).trim();
const BASE = `${ORIGIN}/api/@powerhousedao/knowledge-note`;
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function gql(query, variables) {
  const r = await fetch(`${ORIGIN}/graphql`, { method: "POST", headers: H, body: JSON.stringify({ query, variables }) });
  const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data;
}
async function getDoc(id) {
  const r = await fetch(`${BASE}/notes/${id}?drive=${DRIVE}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${id} → ${r.status}`); return r.json();
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// sources are not graph-indexed: enumerate them from the drive document
const data = await gql(`query($d: String!) { document(identifier: $d) { document { state } } }`, { d: DRIVE }).catch(() => null);
let ids;
if (data?.document?.document?.state) {
  const nodes = data.document.document.state?.global?.nodes ?? [];
  ids = nodes.filter((n) => n.documentType === "bai/source").map((n) => n.id);
} else {
  // fall back to the CLI's drive listing
  const list = JSON.parse(execSync(`switchboard docs list --drive ${DRIVE} --format json`, { encoding: "utf8", maxBuffer: 1 << 28 }));
  ids = list.filter((d) => (d.documentType ?? d.header?.documentType) === "bai/source").map((d) => d.id ?? d.header.id);
}
console.log(`${APPLY ? "APPLY" : "DRY RUN"} · drive ${DRIVE} · ${ids.length} sources`);

const rows = await pool(ids, 8, async (id) => {
  const g = (await getDoc(id))?.state?.global ?? {};
  const refs = (g.extractedClaims ?? []).length; const st = g.extractionStats;
  return { id, title: g.title, status: g.status, refs, st };
});
const noStats = rows.filter((r) => !r.st);
const mismatch = rows.filter((r) => r.st && r.st.claimCount !== r.refs);
console.log(`consistent: ${rows.length - noStats.length - mismatch.length} · mismatched: ${mismatch.length} · no stats (untouched): ${noStats.length}`);
for (const r of mismatch) console.log(`  ${r.id}  claimCount ${r.st.claimCount} → ${r.refs}  skipped ${r.st.skippedCount}  ${r.title?.slice(0, 60)}`);
if (noStats.length) console.log("no stats by status:", noStats.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}));
if (!APPLY) { console.log("dry run — nothing written. Re-run with --apply."); process.exit(0); }

const results = await pool(mismatch, 8, async (r) => {
  const skipped = r.st.skippedCount ?? 0;
  const input = {
    claimCount: r.refs, skippedCount: skipped,
    skipRate: r.refs + skipped === 0 ? 0 : skipped / (r.refs + skipped),
    extractedAt: r.st.extractedAt ?? new Date().toISOString(),
    ...(r.st.extractedBy ? { extractedBy: r.st.extractedBy } : {}),
  };
  const res = await fetch(`${BASE}/actions`, { method: "POST", headers: H, body: JSON.stringify({ documentId: r.id, wait: true, actions: [{ type: "RECORD_EXTRACTION_STATS", scope: "global", input }] }) });
  const j = await res.json().catch(() => ({}));
  const opErr = (j.operations ?? []).find((o) => o.error)?.error;
  if (!res.ok || opErr) return { ...r, ok: false, why: opErr ?? `${res.status} ${j.error ?? ""}` };
  const after = (await getDoc(r.id))?.state?.global?.extractionStats;
  return { ...r, ok: after?.claimCount === r.refs, why: after?.claimCount === r.refs ? "" : `read back ${JSON.stringify(after)}` };
});
const failed = results.filter((x) => !x.ok);
console.log(`repaired and verified: ${results.length - failed.length}/${results.length}`);
for (const f of failed) console.log(`  FAILED ${f.id}: ${f.why}`);
process.exit(failed.length ? 1 : 0);
