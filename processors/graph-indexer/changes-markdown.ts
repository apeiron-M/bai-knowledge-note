/**
 * A change digest as a readable report — what `GET changes` answers to
 * `Accept: text/markdown` (the plugin and other text consumers). Pure and
 * browser-safe, like `changes.ts`.
 */
import type { ChangeDigest, ChangeEvent, ChangeTotals } from "./changes.js";
import type { ChangeStory, Claim, Shift, ThenVsNow } from "./changes-story.js";

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
      const lines =
        s.added === null || s.removed === null
          ? "earlier version not recorded"
          : s.added || s.removed
            ? `+${s.added}/−${s.removed} lines`
            : "text unchanged";
      return `${ref}, ${lines}${s.noteCount ? `, ${s.noteCount} notes` : ""}`;
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

function claimLine(c: Claim): string {
  return `- [[${c.documentId}]] ${oneLine(c.claim, 160)}${c.gist ? ` — ${oneLine(c.gist, 160)}` : ""}`;
}

function shiftLine(s: Shift): string {
  // A description-only shift reads the same by claim: show the gists then.
  const sameClaim = s.then.claim === s.now.claim;
  const text = (t: { claim: string; gist: string | null }) =>
    `“${oneLine(t.claim, 140)}${sameClaim ? ` — ${t.gist === null ? "no description" : oneLine(t.gist, 120)}` : ""}”`;
  return (
    `- [[${s.documentId}]] then ${text(s.then)} → now ${text(s.now)}` +
    (s.replacedBy ? ` [[${s.replacedBy}]]` : "") +
    (s.why ? ` — because ${oneLine(s.why, 160)}` : "")
  );
}

/** The story first: how the vault grew, then per area what is new, what changed, what retired. */
function storySection(story: ChangeStory, out: string[]): void {
  const g = story.growth;
  out.push("## What the vault knows now", "", `Live notes: ${g.notesThen} → ${g.notesNow}.`);
  if (g.newAreas.length) out.push(`New areas: ${g.newAreas.map((a) => a.title).join(", ")}.`);
  if (g.newMaps.length) out.push(`New maps: ${g.newMaps.map((m) => (m.area ? `${m.title} (${m.area})` : m.title)).join(", ")}.`);
  out.push("");
  for (const a of story.areas) {
    out.push(`### ${a.title} — ${a.notesThen} → ${a.notesNow} notes`, "");
    const more = (shown: number, count: number, word: string) => (count > shown ? [`- …and ${count - shown} more ${word}`] : []);
    if (a.newClaims.length) out.push("New:", ...a.newClaims.map(claimLine), ...more(a.newClaims.length, a.newCount, "new"), "");
    if (a.changedClaims.length) out.push("Now understood differently:", ...a.changedClaims.map(shiftLine), ...more(a.changedClaims.length, a.changedCount, "changed"), "");
    if (a.retiredClaims.length) out.push("Retired:", ...a.retiredClaims.map(claimLine), ...more(a.retiredClaims.length, a.retiredCount, "retired"), "");
  }
}

function thenVsNowSection(t: ThenVsNow, out: string[]): void {
  out.push("## Then vs now", "", "Then:", ...(t.then.length ? t.then.map(claimLine) : ["- (nothing in scope yet)"]), "");
  out.push("Now:", ...(t.now.length ? t.now.map(claimLine) : ["- (nothing in scope now)"]), "");
  if (t.unchanged.length) out.push("Unchanged:", ...t.unchanged.map(claimLine), "");
}

export function renderChangesMarkdown(d: ChangeDigest): string {
  const out: string[] = [`# Changes ${d.window.since} → ${d.window.until}`, ""];
  if (d.totals.documents === 0 && !d.thenVsNow) {
    out.push("Nothing changed in this window.");
    return out.join("\n") + "\n";
  }
  if (d.story) storySection(d.story, out);
  if (d.thenVsNow) thenVsNowSection(d.thenVsNow, out);
  if (d.story || d.thenVsNow) out.push("## Detail", "");
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
