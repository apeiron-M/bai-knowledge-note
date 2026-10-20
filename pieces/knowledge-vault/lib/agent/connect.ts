import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage, KnowledgeVaultApiError } from "../common/errors.js";
import { CONVERGENCE_REASON_PREFIX } from "./write.js";
import { completeJson, type LlmClient } from "./llm.js";

/**
 * Connect: typed links between the notes a source produced and the rest of
 * the vault. Candidates are found deterministically (the vault's semantic
 * neighbours, and the note's siblings from the same source); one model call
 * judges which links hold; the harness enforces the articulation test in
 * data (a specific reason on every edge) before anything is written.
 */

export const LINK_TYPES = ["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
const CONFIDENCE = ["grounded", "established", "speculative"] as const;

export type NoteSummary = { id: string; title: string; description: string; status: string | null };
export type ProposedLink = { from: string; to: string; type: LinkType; reason: string; confidence: string };

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

type NoteDoc = { name?: string; state?: { global?: { title?: string; description?: string; status?: string } }; edges?: { direction?: string; documentId?: string; linkType?: string; reason?: string | null }[] };

/**
 * False only when this note's DERIVED_FROM link to `sourceId` is a convergence link (its reason starts
 * with the prefix write mode gives one): the note was made by an earlier source and this one only lists
 * it. Any other link, however many other sources the note also derives from, means this source made it.
 */
export function madeBySource(edges: { direction?: string; documentId?: string; linkType?: string; reason?: string | null }[] | undefined, sourceId: string): boolean {
  return !(edges ?? []).some((e) => e.linkType === "DERIVED_FROM" && e.direction === "out" && e.documentId === sourceId && typeof e.reason === "string" && e.reason.startsWith(CONVERGENCE_REASON_PREFIX));
}

/** The notes a source produced, read from the source's own record of them. */
export async function sourceNotes(client: KnowledgeVaultClient, drive: string, sourceId: string) {
  const src = await client.request<{ name: string; state?: { global?: { title?: string; status?: string; extractedClaims?: unknown[] } } }>({ path: `notes/${encodeURIComponent(sourceId)}`, query: { drive } });
  const title = src.state?.global?.title ?? src.name;
  const ids = arr(src.state?.global?.extractedClaims).map((c) => (typeof c === "string" ? c : str(rec(c).claimRef))).filter(Boolean);
  // Extracted, or archived as holding no knowledge, with zero claims: a finished source, not a missing step.
  const status = src.state?.global?.status;
  if (ids.length === 0 && (status === "EXTRACTED" || status === "ARCHIVED")) return { sourceTitle: title, notes: [] as (NoteSummary & { edges: NoteDoc["edges"] })[] };
  if (ids.length === 0) {
    throw new KnowledgeVaultApiError(`"${title}" has no extracted notes yet. Run Extract claims in write mode on it first.`, { category: "validation" });
  }
  const notes: (NoteSummary & { edges: NoteDoc["edges"] })[] = [];
  for (const id of ids) {
    const doc = await client.request<NoteDoc>({ path: `notes/${encodeURIComponent(id)}`, query: { drive } });
    const g = doc.state?.global ?? {};
    if (g.status === "ARCHIVED") continue;
    // A note the source found already in the vault was worked on when its own source made it.
    if (!madeBySource(doc.edges, sourceId)) continue;
    notes.push({ id, title: g.title ?? doc.name ?? id, description: g.description ?? "", status: g.status ?? null, edges: doc.edges ?? [] });
  }
  return { sourceTitle: title, notes };
}

type SimilarRow = { similarity?: number; node?: { documentId?: string; title?: string; description?: string; status?: string } };

export async function gatherCandidates(client: KnowledgeVaultClient, drive: string, notes: NoteSummary[], perNote = 8) {
  const siblings = new Set(notes.map((n) => n.id));
  const candidates: Record<string, (NoteSummary & { similarity: number | null })[]> = {};
  for (const note of notes) {
    const rows = await client.request<SimilarRow[]>({ path: `notes/${encodeURIComponent(note.id)}/similar`, query: { drive, limit: perNote + 4 } }).catch(() => []);
    const near = rows
      .map((r) => ({ id: str(r.node?.documentId), title: str(r.node?.title), description: str(r.node?.description), status: r.node?.status ?? null, similarity: typeof r.similarity === "number" ? Math.round(r.similarity * 1000) / 1000 : null }))
      .filter((c) => c.id && c.id !== note.id && c.status !== "MOC" && c.status !== "ARCHIVED" && !siblings.has(c.id))
      .slice(0, perNote);
    const sibs = notes.filter((n) => n.id !== note.id).map((n) => ({ ...n, similarity: null }));
    candidates[note.id] = [...sibs, ...near];
  }
  return candidates;
}

export const CONNECT_SYSTEM = `You link atomic notes in a knowledge vault. Answer with JSON only.

For each NEW note you get a list of candidate notes. Propose a link only when you can complete, specifically: "[from] connects to [to] because ...". A reason that restates the two titles, names the link type, or could fit any pair is not a reason.
The reason is stored on the link and read on its own, so name each note by its subject in words ("the legacy-drag note", "the claim that capital is not the constraint"). Never refer to notes by letters (A, B, C) or ids.
"from" and "to" are ids, copied exactly as listed; words go only in "reason".

Types (from → to):
- BUILDS_ON: from extends, applies or strengthens to's claim.
- RELATES_TO: a real thematic connection that is not extension.
- CONTRADICTS: from challenges to's claim; the two cannot both hold as stated. Use only for a real conflict.
- SUPERSEDES: from replaces to (to is outdated). Rare.
Confidence: grounded (the notes' evidence shows it), established (well accepted), speculative (a plausible lead).

Aim for 2-4 links per new note, including links among the new notes where one builds on another. Zero links for a note is allowed when nothing holds; never invent one to reach a count.

Answer: {"links":[{"from":"<new note id>","to":"<candidate id>","type":"BUILDS_ON","reason":"...","confidence":"grounded"}]}`;

/** Lower case, punctuation collapsed, a leading "the", "a" or "new note" and a trailing "note" dropped. */
export function normaliseName(text: string): string {
  let t = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (let before = ""; before !== t; ) {
    before = t;
    t = t.replace(/^(the|a|new note) /, "");
  }
  return t.replace(/ note$/, "");
}

const nameWords = (t: string) => t.split(" ").filter((w) => w.length >= 3);
/** At least 80% of the shorter text's words of 3+ characters appear in the other; the shorter needs two such words. */
function wordsOverlap(a: string, b: string): boolean {
  const [wa, wb] = [nameWords(a), nameWords(b)];
  const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  return short.length >= 2 && short.filter((w) => long.has(w)).length / short.length >= 0.8;
}

/**
 * The note a link's "from" or "to" names, among the notes it may name. The model is asked for ids,
 * but a model on this computer often writes "the new note <id>" or the note's title in its own
 * words. Those are matched here, only within the allowed notes; a name that could be several
 * notes is refused rather than guessed.
 */
export function resolveNoteRef(text: string, allowed: { id: string; title: string }[]): { id: string } | { matches: number } {
  const raw = text.trim();
  if (!raw) return { matches: 0 };
  if (allowed.some((n) => n.id === raw)) return { id: raw };
  const inside = allowed.filter((n) => n.id && raw.includes(n.id));
  if (inside.length === 1) return { id: inside[0].id };
  if (inside.length > 1) return { matches: inside.length };
  const name = normaliseName(raw);
  if (!name) return { matches: 0 };
  const titled = allowed.map((n) => ({ id: n.id, title: normaliseName(n.title) })).filter((n) => n.title);
  const tiers: ((title: string) => boolean)[] = [
    (title) => title === name,
    (title) => {
      const [short, long] = title.length <= name.length ? [title, name] : [name, title];
      return short.length >= 24 && long.startsWith(short);
    },
    (title) => wordsOverlap(title, name),
  ];
  for (const fits of tiers) {
    const hits = titled.filter((n) => fits(n.title));
    if (hits.length === 1) return { id: hits[0].id };
    if (hits.length > 1) return { matches: hits.length };
  }
  return { matches: 0 };
}

/** The articulation test the vault enforces on knowledge edges, applied before writing. */
export function checkLink(link: Record<string, unknown>, allowed: Map<string, Set<string>>): string | null {
  const from = str(link.from);
  const to = str(link.to);
  const reason = str(link.reason).trim();
  if (!allowed.has(from)) return `from "${from}" is not one of the new notes`;
  if (!allowed.get(from)?.has(to)) return `to "${to}" was not a candidate for ${from}`;
  if (!(LINK_TYPES as readonly string[]).includes(str(link.type))) return `type must be one of ${LINK_TYPES.join(", ")}`;
  if (reason.length < 20) return "the reason is too short to say why the link holds";
  if (/^(relates to|builds on|contradicts|supersedes|because)\b/i.test(reason) && reason.split(/\s+/).length < 6) return "the reason names the link instead of explaining it";
  // Letter labels ("C supplies what E needs") mean nothing once the reason is stored on its own.
  if (/(?<![\w-])[B-H]('s)?(?![\w-])/.test(reason) || /\bA('s)? (connects|describes|takes|extends|builds|says|argues|claims|identifies|adds|supplies|shows|reports)\b/.test(reason) || reason.includes(from) || reason.includes(to)) return "the reason refers to notes by a letter or id; name them by their subject";
  return null;
}

/** Notes per model call: all at once took 158 s for six notes, close to the 180 s per-call limit. */
export const NOTES_PER_CALL = 3;

function promptFor(notes: NoteSummary[], candidates: Record<string, (NoteSummary & { similarity: number | null })[]>): string {
  return notes
    .map((n) => [
      `NEW ${n.id}: ${n.title}`,
      `  ${n.description}`,
      "  candidates:",
      ...(candidates[n.id] ?? []).map((c) => `  - ${c.id}${c.similarity !== null ? ` (${c.similarity})` : " (same source)"}: ${c.title} — ${c.description}`),
    ].join("\n"))
    .join("\n\n");
}

export async function proposeLinksStage(llm: LlmClient, model: string, notes: NoteSummary[], candidates: Record<string, (NoteSummary & { similarity: number | null })[]>, fetchImpl?: typeof fetch) {
  const batches: NoteSummary[][] = [];
  for (let i = 0; i < notes.length; i += NOTES_PER_CALL) batches.push(notes.slice(i, i + NOTES_PER_CALL));
  // In parallel: each batch still sees every sibling as a candidate, so links across batches are found.
  const replies = await Promise.all(
    batches.map((batch) => completeJson(llm, { model, system: CONNECT_SYSTEM, user: promptFor(batch, candidates), maxTokens: 24_000, reasoningEffort: "low" }, fetchImpl)),
  );
  const allowed = new Map(notes.map((n) => [n.id, new Set((candidates[n.id] ?? []).map((c) => c.id))]));
  const newNotes = notes.map((n) => ({ id: n.id, title: n.title }));
  const accepted: ProposedLink[] = [];
  const dropped: { link: string; why: string }[] = [];
  const seen = new Set<string>();
  let cost = 0;
  for (const { value, usage } of replies) {
    cost += usage.cost;
    for (const raw of arr(rec(value).links).map(rec)) {
      const label = `${str(raw.from)} → ${str(raw.to)}`;
      // A note named in words, or as "the new note <id>", is resolved within what each end may name.
      const from = resolveNoteRef(str(raw.from), newNotes);
      if (!("id" in from)) {
        dropped.push({ link: label, why: from.matches ? `from "${str(raw.from)}" could be ${from.matches} of the new notes` : `from "${str(raw.from)}" is not one of the new notes` });
        continue;
      }
      const to = resolveNoteRef(str(raw.to), (candidates[from.id] ?? []).map((c) => ({ id: c.id, title: c.title })));
      if (!("id" in to)) {
        dropped.push({ link: label, why: to.matches ? `to "${str(raw.to)}" could be ${to.matches} of the candidates for ${from.id}` : `to "${str(raw.to)}" was not a candidate for ${from.id}` });
        continue;
      }
      const why = checkLink({ ...raw, from: from.id, to: to.id }, allowed);
      const key = `${from.id}>${to.id}`;
      if (why) dropped.push({ link: label, why });
      else if (seen.has(key) || seen.has(`${to.id}>${from.id}`)) dropped.push({ link: key.replace(">", " → "), why: "a link between these two is already proposed" });
      else {
        seen.add(key);
        const confidence = (CONFIDENCE as readonly string[]).includes(str(raw.confidence)) ? str(raw.confidence) : "speculative";
        accepted.push({ from: from.id, to: to.id, type: str(raw.type) as LinkType, reason: str(raw.reason).trim(), confidence });
      }
    }
  }
  const byNote = new Map(notes.map((n) => [n.id, 0]));
  for (const l of accepted) {
    byNote.set(l.from, (byNote.get(l.from) ?? 0) + 1);
    if (byNote.has(l.to)) byNote.set(l.to, (byNote.get(l.to) ?? 0) + 1);
  }
  const thin = notes.filter((n) => (byNote.get(n.id) ?? 0) < 2);
  return {
    summary: `Proposed ${accepted.length} link${accepted.length === 1 ? "" : "s"} for ${notes.length} notes in ${batches.length} call${batches.length === 1 ? "" : "s"}${dropped.length ? ` (${dropped.length} dropped by the articulation check)` : ""}${thin.length ? `; ${thin.length} note${thin.length === 1 ? " has" : "s have"} fewer than 2` : ""}.`,
    links: accepted,
    dropped,
    thin: thin.map((n) => n.title),
    cost_usd: Math.round(cost * 10_000) / 10_000,
  };
}

export async function writeLinksStage(client: KnowledgeVaultClient, links: ProposedLink[]) {
  const written: ProposedLink[] = [];
  const failed: { link: string; error: string }[] = [];
  for (const l of links) {
    try {
      await client.request({ method: "POST", path: "relationships", json: { source: l.from, target: l.to, type: l.type, reason: l.reason, confidence: l.confidence } });
      written.push(l);
    } catch (error) {
      failed.push({ link: `${l.from} → ${l.to} (${l.type})`, error: errorMessage(error) });
    }
  }
  const contradictions = written.filter((l) => l.type === "CONTRADICTS").length;
  return {
    summary: `Wrote ${written.length} link${written.length === 1 ? "" : "s"}${failed.length ? `, ${failed.length} refused by the vault` : ""}${contradictions ? `; ${contradictions} CONTRADICTS link${contradictions === 1 ? "" : "s"}, each opens a tension` : ""}.`,
    written,
    failed,
  };
}
