/**
 * A change digest as a readable report — what `GET changes` answers to
 * `Accept: text/markdown` (the plugin and other text consumers). Pure and
 * browser-safe, like `changes.ts`.
 */
import type { ChangeDigest, ChangeEvent, ChangeTotals } from "./changes.js";

const ONE_LINE = 120;

function oneLine(s: string, max = ONE_LINE): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function quoted(s: string | null): string {
  return s === null ? "not set before" : `“${oneLine(s, 80)}”`;
}

/** The totals that are not zero, in words. */
export function totalsLine(t: ChangeTotals): string {
  const parts: string[] = [];
  const add = (n: number, word: string) => {
    if (n > 0) parts.push(`${n} ${word}`);
  };
  add(t.created, "created");
  add(t.revised, "revised");
  add(t.superseded, "superseded");
  add(t.archived, "archived");
  add(t.reverified, "re-verified");
  add(t.sourcesRevised, "sources revised");
  add(t.sourcesAdded, "sources added");
  const head = parts.length ? parts.join(", ") : "no changes";
  return `${head} — ${t.documents} document${t.documents === 1 ? "" : "s"}, ${t.operations} operation${t.operations === 1 ? "" : "s"}`;
}

/** What happened, in one line, after the title. */
function detail(e: ChangeEvent): string {
  switch (e.kind) {
    case "revised": {
      const f = e.fields ?? {};
      const parts: string[] = [];
      if (f.title) parts.push(`title ${quoted(f.title.before)} → ${quoted(f.title.after)}`);
      if (f.description) parts.push(`description ${quoted(f.description.before)} → ${quoted(f.description.after)}`);
      if (f.content) parts.push(`content +${f.content.added}/−${f.content.removed} lines`);
      const note = e.revisionNotes?.[0];
      return parts.join("; ") + (note ? ` (${oneLine(note, 100)})` : "");
    }
    case "superseded":
      return e.supersededBy
        ? `by [[${e.supersededBy.documentId}]] ${oneLine(e.supersededBy.title, 80)}${e.supersededBy.reason ? ` — ${oneLine(e.supersededBy.reason, 100)}` : ""}`
        : "";
    case "reverified":
      return e.version ? `version ${e.version.before ?? "not set before"} → ${e.version.after}` : "";
    case "source-revised": {
      const s = e.source;
      if (!s) return "";
      const ref = s.refBefore || s.refAfter ? `${s.refBefore ?? "?"} → ${s.refAfter ?? "?"}` : "re-ingested";
      const lines = s.added || s.removed ? `+${s.added}/−${s.removed} lines` : "text unchanged";
      return `${ref}, ${lines}${s.noteIds.length ? `, ${s.noteIds.length} notes` : ""}`;
    }
    case "created":
      return e.derivedFrom?.length ? `from ${e.derivedFrom.map((id) => `[[${id}]]`).join(", ")}` : "";
    case "archived":
    case "restored":
    case "approved":
      return [e.by ? `by ${e.by}` : "", e.comment ? oneLine(e.comment, 100) : ""].filter(Boolean).join(" — ");
    default:
      return "";
  }
}

function bullet(e: ChangeEvent): string {
  const d = detail(e);
  return `- [[${e.documentId}]] ${oneLine(e.title, 100)} — ${e.kind}${d ? `: ${d}` : ""}`;
}

export function renderChangesMarkdown(d: ChangeDigest): string {
  const out: string[] = [`# Changes ${d.window.since} → ${d.window.until}`, ""];
  if (d.totals.documents === 0) {
    out.push("Nothing changed in this window.");
    return out.join("\n") + "\n";
  }
  out.push(totalsLine(d.totals), "");
  for (const g of d.groups) {
    out.push(`## ${g.title}`, "", totalsLine(g.totals), "");
    for (const e of g.highlights) out.push(bullet(e));
    out.push("");
  }
  if (d.events) {
    out.push("## Changes", "");
    for (const e of d.events) {
      out.push(bullet(e));
      for (const h of e.fields?.content?.hunks ?? e.source?.hunks ?? []) {
        out.push("  ```diff", ...h.split("\n").map((l) => `  ${l}`), "  ```");
      }
    }
    out.push("");
    if (d.nextCursor) out.push(`Next page: cursor=${d.nextCursor}`, "");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}
