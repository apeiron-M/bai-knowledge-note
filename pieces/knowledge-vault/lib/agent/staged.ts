import type { KnowledgeVaultClient } from "../common/client.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { checkProposal, CONFIDENCE, GATES, NOTE_TYPES, OTHER_GATE, type ProposedNote, type SkippedCandidate } from "./extract.js";
import { completeJson, type LlmClient, type Usage } from "./llm.js";
import { draftBatchFor, MIN_WINDOW_CHARS, paceFor, splitInHalf, windowSize, WindowCursor, type TextWindow } from "./windows.js";

/**
 * The extract job as five workflow steps, so Studio shows each one finish
 * with its own output and duration: read → candidates → vault check → draft
 * → report. Only candidates and draft call the model, once each (plus one
 * repair round in draft); the searches run deterministically, once per
 * candidate, instead of the model searching until it feels sure.
 *
 * Every stage returns a `summary` sentence first: Studio renders step output
 * as JSON, so the human-readable line has to be a top-level string.
 */

export type TopicInfo = { name: string; notes: number; example: string | null };

export type SourceBundle = {
  source_id: string;
  title: string;
  source_type: string | null;
  status: string | null;
  chars: number;
  text: string;
  figures: number;
  /** Notes already recorded as extracted from this source. */
  extracted_claims: number;
  /** Live (not archived) notes linked to it with DERIVED_FROM: set even when a stopped step never recorded them. */
  derived_notes: number;
  /** An extraction recorded its stats on the source: it ran to the end, even when it found no claims. */
  stats_recorded?: boolean;
  topics: string[];
  /** The most used topics, each with one note title, so the model knows what a name covers here. */
  topic_examples: TopicInfo[];
};

const TOPIC_EXAMPLES = 60;

export type Candidate = { id: string; claim: string; locus: string; evidence: string };
export type VaultMatch = { id: string; title: string; similarity: number; eligible: boolean };
export type CheckedCandidate = Candidate & { window: string | null; matches: VaultMatch[]; likely_duplicate: boolean };

const MAX_SOURCE_CHARS = 60_000;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A step's input is whatever the previous step returned: an object, or its JSON as text. */
export function asObject(value: unknown, what: string): Record<string, unknown> {
  const parsed: unknown = typeof value === "string" ? safeParse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new KnowledgeVaultApiError(`${what} is missing: map it to the output of the step before, e.g. {{steps.read.output}}`, { category: "validation" });
  }
  return parsed as Record<string, unknown>;
}
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
/** Run `work` over `items`, at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i], i);
    }
  });
  await Promise.all(lanes);
  return out;
}
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── 1. read ──────────────────────────────────────────────────────────────

export async function readSourceStage(client: KnowledgeVaultClient, drive: string, sourceId: string): Promise<SourceBundle & { summary: string }> {
  const doc = await client.request<{ name: string; edges?: { direction?: string; documentId?: string; linkType?: string }[]; state?: { global?: { title?: string; content?: string; sourceType?: string; status?: string; attachments?: unknown[]; extractedClaims?: unknown[]; extractionStats?: unknown } } }>({ path: `notes/${encodeURIComponent(sourceId)}`, query: { drive } });
  const derivedIds = [...new Set((doc.edges ?? []).filter((e) => e.linkType === "DERIVED_FROM" && e.direction === "in" && e.documentId).map((e) => str(e.documentId)))];
  const derivedStatus = await mapLimit(derivedIds, 8, (id) =>
    client.request<{ state?: { global?: { status?: string } } }>({ path: `notes/${encodeURIComponent(id)}`, query: { drive } }).then((d) => d.state?.global?.status ?? null, () => null),
  );
  const derived_notes = derivedStatus.filter((st) => st !== null && st !== "ARCHIVED").length;
  const g = doc.state?.global ?? {};
  const content = g.content ?? "";
  const topicsBody = await client.request<{ topics?: { name: string; noteCount: number }[] } | { name: string; noteCount: number }[]>({ path: "topics", query: { drive } });
  const ranked = (Array.isArray(topicsBody) ? topicsBody : (topicsBody.topics ?? [])).sort((a, b) => b.noteCount - a.noteCount);
  const topics = ranked.map((t) => t.name);
  // In parallel: sixty lookups one after another took 6 s on a remote vault.
  const topic_examples: TopicInfo[] = await mapLimit(ranked.slice(0, TOPIC_EXAMPLES), 8, async (t) => {
    const notes = await client
      .request<{ title?: string; status?: string }[] | { nodes?: { title?: string; status?: string }[] }>({ path: `topics/${encodeURIComponent(t.name)}`, query: { drive } })
      .catch(() => []);
    const list = Array.isArray(notes) ? notes : (notes.nodes ?? []);
    return { name: t.name, notes: t.noteCount, example: list.find((n) => n.status !== "MOC" && n.title)?.title ?? null };
  });
  const figures = arr(g.attachments).length;
  const title = g.title ?? doc.name;
  if (!content.trim()) throw new KnowledgeVaultApiError(`The source "${title}" has no text to extract from`, { category: "validation" });
  const text = content.length > MAX_SOURCE_CHARS ? content.slice(0, MAX_SOURCE_CHARS) : content;
  return {
    summary: `Read "${title}": ${content.length.toLocaleString("en")} characters${content.length > MAX_SOURCE_CHARS ? ` (first ${MAX_SOURCE_CHARS.toLocaleString("en")} used)` : ""}, ${figures} figure${figures === 1 ? "" : "s"} (not readable by the model), ${topics.length} vault topics.`,
    source_id: sourceId,
    title,
    source_type: g.sourceType ?? null,
    status: g.status ?? null,
    chars: content.length,
    text,
    figures,
    extracted_claims: arr(g.extractedClaims).length,
    derived_notes,
    stats_recorded: !!g.extractionStats,
    topics,
    topic_examples,
  };
}

// ── 2. candidates ────────────────────────────────────────────────────────

export const CANDIDATES_SYSTEM = `You find atomic knowledge claims in ONE part of a source (the whole source when it is short) for a knowledge vault. Answer with JSON only.

List every candidate claim in the text, in your own words, then run six gates on each. A claim passes only if all six hold:
1 sentence: completes "This note argues that ...". Not a label, heading or caption.
2 transclusion: works as a clause: "Since [claim], it follows that ...". Not a question.
3 falsifiability: a competent practitioner could disagree. "Quality matters" fails.
4 coherence: statable in 1-3 sentences without "and also"; bundles are several candidates.
5 independence: holds for a reader who never saw the source.
6 non_attribution: asserts what is TRUE, not what someone said.
Not claims: excerpts, summaries, headings, captions, anecdotes (they are evidence), bare numbers, restated structure, definitions with no stake.
Conditions travel inside the claim ("X improves Y only when Z").
A claim may describe how something works or what usually happens ("most inference runs on rented cloud GPUs", "memory bandwidth, not compute, limits decoding speed"): keep it when a practitioner could reasonably say otherwise. Never strike a statement only because it is descriptive, practical or technical.
Every subject the source covers is in scope, including subjects the vault has no notes on yet.
Two candidates that make the same assertion: keep one, strike the other as "duplicate".

Zero survivors is a valid answer for a foreword or glossary; a high skip rate is a finding.

A kept claim is the INFERENCE a finding supports, never the finding restated: "74% invest over $50m" is evidence; "once spend is that high, budget no longer separates organizations" is a claim. Never copy a source sentence as the claim.
For each kept claim, say what a competent practitioner who disagrees would argue. If you cannot, the claim fails falsifiability: strike it.

List only statements. Leave out headings, survey questions, figure captions and name credits entirely; count them in "non_claims".

Say what kind of text this is: "source_kind" is "not_knowledge" only when the text holds no claims by its nature (a list of references, an index, a glossary of terms, front matter, contact details), with the reason in a few words in "source_kind_reason"; otherwise "knowledge".

Answer: {"source_kind":"knowledge","source_kind_reason":"","non_claims":0,"kept":[{"claim":"...","locus":"section and paragraph","evidence":"the source's own words that support it","disagreement":"what a practitioner who disagrees would argue"}],"skipped":[{"candidate":"...","gate":"${GATES.join("|")}","reason":"..."}]}`;

export type WindowCandidates = {
  window: TextWindow;
  kept: (Candidate & { window: string })[];
  skipped: SkippedCandidate[];
  nonClaimsCounted: number;
  sourceKind: "knowledge" | "not_knowledge";
  sourceKindReason: string;
  /** Nothing kept, nothing struck, no non-claims, and not judged to hold no knowledge: no answer at all. */
  empty: boolean;
  usage: Usage;
};

/** One window through the candidate prompt: its claims, its rejections, and whether it holds knowledge at all. */
export async function candidatesForWindow(llm: LlmClient, model: string, title: string, window: TextWindow, wholeSource: string, fetchImpl?: typeof fetch): Promise<WindowCandidates> {
  const { value, usage } = await completeJson(llm, {
    model,
    system: CANDIDATES_SYSTEM,
    user: `Source title: ${title}${window.heading ? `\nSection: ${window.heading}` : ""}\n\n${window.text}`,
    // Listing candidates needs little deliberation; unbounded reasoning took 45-180 s here.
    reasoningEffort: "low",
  }, fetchImpl);
  const answer = asObject(value, "The model's answer");
  const kept: (Candidate & { window: string })[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const c of arr(answer.kept).map((x) => asRecord(x))) {
    const claim = str(c.claim).trim();
    if (!claim) continue;
    // The gates the model tends to wave through, enforced here.
    if (BARE_STATISTIC.test(claim)) skipped.push({ candidate: claim, gate: "falsifiability", reason: "A bare statistic: evidence for a claim, not a claim (struck by the harness)" });
    else if (!str(c.disagreement).trim()) skipped.push({ candidate: claim, gate: "falsifiability", reason: "No position a practitioner could take against it (struck by the harness)" });
    else if (containsVerbatim(wholeSource, claim)) skipped.push({ candidate: claim, gate: "sentence", reason: "Copied from the source rather than stated as the inference it supports (struck by the harness)" });
    else kept.push({ id: "", claim, locus: str(c.locus), evidence: str(c.evidence), window: window.id });
  }
  skipped.push(...arr(answer.skipped)
    .map((c) => asRecord(c))
    .filter((c) => str(c.candidate).trim())
    .map((c) => ({ candidate: str(c.candidate), gate: (GATES as readonly string[]).includes(str(c.gate)) ? (str(c.gate) as SkippedCandidate["gate"]) : OTHER_GATE, reason: str(c.reason) })));
  const nonClaimsCounted = Math.max(0, Math.round(Number(answer.non_claims) || 0));
  const notKnowledge = str(answer.source_kind).trim().toLowerCase() === "not_knowledge";
  return {
    window,
    kept,
    skipped,
    nonClaimsCounted,
    sourceKind: notKnowledge ? "not_knowledge" : "knowledge",
    sourceKindReason: notKnowledge ? str(answer.source_kind_reason).trim() : "",
    empty: !notKnowledge && arr(answer.kept).length === 0 && arr(answer.skipped).length === 0 && nonClaimsCounted === 0,
    usage,
  };
}

/** An answer the model could not give in JSON, after completeJson's own second try. */
const isUnreadableAnswer = (error: unknown) => error instanceof KnowledgeVaultApiError && /did not answer with JSON|malformed JSON|gave no answer twice|empty response twice/.test(error.message);
const describePart = (w: TextWindow) => (w.heading ? `"${w.heading}" (${w.id})` : w.id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function candidatesStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, fetchImpl?: typeof fetch, opts: { windowChars?: number | null } = {}) {
  const text = str(bundle.text);
  const title = str(bundle.title);
  const cursor = new WindowCursor(text);
  const redo: TextWindow[] = [];
  const results: WindowCandidates[] = [];
  const emptyParts: TextWindow[] = [];
  const unreadable: TextWindow[] = [];
  let lastError: unknown = null;

  type Outcome = { kind: "read"; out: WindowCandidates } | { kind: "empty"; window: TextWindow } | { kind: "unreadable"; window: TextWindow; error: unknown };
  async function readWindow(w: TextWindow): Promise<Outcome> {
    for (let ask = 1; ask <= 2; ask++) {
      let out: WindowCandidates;
      try {
        out = await candidatesForWindow(llm, model, title, w, text, fetchImpl);
      } catch (error) {
        if (isUnreadableAnswer(error)) return { kind: "unreadable", window: w, error };
        throw error;
      }
      // An empty answer for a window this long is asked once more; a short one is taken as it is.
      if (!out.empty || w.text.length < MIN_WINDOW_CHARS) return { kind: "read", out };
    }
    return { kind: "empty", window: w };
  }

  while (redo.length || !cursor.done) {
    // Asked afresh before every batch (one local call): the windows still to come are sized and paced
    // for the model in charge now, even when the user switched a moment ago.
    const live = await llm.active(fetchImpl, true);
    const size = windowSize({ locality: live.locality, contextTokens: live.contextTokens, override: opts.windowChars });
    const batch: TextWindow[] = [];
    while (batch.length < paceFor(live.locality)) {
      const next = redo.shift() ?? cursor.next(size);
      if (!next) break;
      batch.push(next);
    }
    const outcomes = await mapLimit(batch, batch.length, readWindow);
    for (const o of outcomes) {
      if (o.kind === "read") {
        results.push(o.out);
        continue;
      }
      if (o.kind === "unreadable") lastError = o.error;
      const halves = splitInHalf(o.window);
      if (halves) redo.unshift(...halves);
      else (o.kind === "empty" ? emptyParts : unreadable).push(o.window);
    }
  }
  if (results.length === 0 && unreadable.length) throw lastError;

  let n = 0;
  const kept = results.flatMap((r) => r.kept).map((c) => ({ ...c, id: `c${++n}` }));
  const breakdown = classifySkips(results.flatMap((r) => r.skipped));
  const nonClaims = results.reduce((sum, r) => sum + r.nonClaimsCounted, 0) + breakdown.not_a_claim.length;
  const other = breakdown.rejected.filter((s) => s.gate === OTHER_GATE).length;
  const distinct = kept.length + breakdown.rejected.length;
  const parts = results.length + emptyParts.length + unreadable.length;
  // "Not knowledge" only when every part was read and said so, and nothing in it was kept as a claim:
  // a part that stayed empty or unreadable never said, and a kept claim means the source holds knowledge.
  const notKnowledge =
    results.length > 0 && emptyParts.length === 0 && unreadable.length === 0 && kept.length === 0 && results.every((r) => r.sourceKind === "not_knowledge");
  const usage = results.reduce((u, r) => ({ cost: u.cost + r.usage.cost, tokens: u.tokens + r.usage.prompt_tokens + r.usage.completion_tokens }), { cost: 0, tokens: 0 });
  return {
    summary:
      `${plural(distinct, "distinct claim")}${parts > 1 ? ` from ${parts} parts` : ""}: ${kept.length} kept, ${breakdown.rejected.length} rejected on a gate` +
      `${other ? ` (${other} for a reason outside the gates)` : ""}` +
      `${breakdown.restatement.length ? `; ${breakdown.restatement.length} restatements of kept claims` : ""}` +
      `${nonClaims ? `; ${nonClaims} non-claims (headings, captions, bare statistics)` : ""}` +
      `${emptyParts.length ? `; ${plural(emptyParts.length, "part")} yielded nothing` : ""}` +
      `${unreadable.length ? `; ${plural(unreadable.length, "part")} could not be read` : ""}.`,
    kept_count: kept.length,
    skipped_count: breakdown.rejected.length,
    restatement_count: breakdown.restatement.length,
    non_claim_count: nonClaims,
    other_gate_count: other,
    kept,
    skipped: breakdown.rejected,
    restatements: breakdown.restatement,
    non_claims: breakdown.not_a_claim,
    windows: results.map((r) => r.window),
    window_count: parts,
    empty_parts: emptyParts.map(describePart),
    unreadable_parts: unreadable.map(describePart),
    source_kind: notKnowledge ? ("not_knowledge" as const) : ("knowledge" as const),
    source_kind_reason: notKnowledge ? results.find((r) => r.sourceKindReason)?.sourceKindReason || "it holds no claims by its nature" : "",
    cost_usd: round4(usage.cost),
    tokens: usage.tokens,
  };
}
/** "74 percent of …", "83% report …", "US$50m …": a number leading the sentence is a finding. */
const BARE_STATISTIC = /^(a |an )?(\d[\d.,]*\s*(%|percent|per cent)|us\$|\$|€|£)/i;

/** True when the source holds this sentence word for word (case, spacing and punctuation aside). */
export function containsVerbatim(source: string, sentence: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const needle = norm(sentence);
  return needle.split(" ").length >= 6 && norm(source).includes(needle);
}

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/**
 * The skip rate the vault reports is rejected claims over distinct claims.
 * Restatements of a kept claim and things that were never claims (headings,
 * captions, bare statistics) are counted apart, or a well-written source
 * that says its thesis four times reads as a failed extraction.
 */
export function classifySkips(skipped: SkippedCandidate[]) {
  const out = { rejected: [] as SkippedCandidate[], restatement: [] as SkippedCandidate[], not_a_claim: [] as SkippedCandidate[] };
  for (const s of skipped) {
    const words = s.candidate.trim().split(/\s+/).length;
    if (s.gate === "duplicate") out.restatement.push(s);
    else if (BARE_STATISTIC.test(s.candidate.trim()) || s.candidate.trim().endsWith("?") || words < 5 || /\b(heading|caption|question|credit|attribution line|bare (statistic|number|data))/i.test(s.reason)) out.not_a_claim.push(s);
    else out.rejected.push(s);
  }
  return out;
}

// ── 3. vault check ───────────────────────────────────────────────────────

/** A claim may converge on an existing note only when the match is this close, live, and not replaced. */
export const CONVERGE_FLOOR = 0.75;

/** True when another note supersedes this one, or when the vault cannot say: a failed read never makes a note eligible. */
async function isSuperseded(client: KnowledgeVaultClient, drive: string, id: string): Promise<boolean> {
  try {
    const doc = await client.request<{ edges?: { direction?: string; linkType?: string }[] }>({ path: `notes/${encodeURIComponent(id)}`, query: { drive } });
    return (doc.edges ?? []).some((e) => e.linkType === "SUPERSEDES" && e.direction === "in");
  } catch {
    return true;
  }
}

export async function checkVaultStage(client: KnowledgeVaultClient, drive: string, candidates: Record<string, unknown>, threshold = 0.9) {
  const kept = arr(candidates.kept).map(asRecord);
  // In parallel: a semantic search embeds its query, 3-4 s each on a remote vault.
  const checked: CheckedCandidate[] = await mapLimit(kept, 4, async (c) => {
    const body = await client.request<{ hits: { node: { documentId?: string; title?: string; status?: string }; similarity: number }[] }>({
      path: "search",
      query: { drive, q: str(c.claim), mode: "semantic", limit: 3, related: 0 },
    });
    const matches: VaultMatch[] = await Promise.all(
      body.hits
        .filter((h) => h.node.status !== "MOC")
        .map(async (h) => {
          const id = str(h.node.documentId);
          const similarity = Math.round(h.similarity * 1000) / 1000;
          const eligible = similarity >= CONVERGE_FLOOR && h.node.status !== "ARCHIVED" && !(await isSuperseded(client, drive, id));
          return { id, title: str(h.node.title), similarity, eligible };
        }),
    );
    return { id: str(c.id), claim: str(c.claim), locus: str(c.locus), evidence: str(c.evidence), window: str(c.window) || null, matches, likely_duplicate: (matches[0]?.similarity ?? 0) >= threshold };
  });
  const dups = checked.filter((c) => c.likely_duplicate);
  return {
    summary: `Searched the vault for ${checked.length} candidate${checked.length === 1 ? "" : "s"}: ${dups.length ? `${dups.length} likely already there (similarity ≥ ${threshold})` : "none already there"}${checked.length ? `; best match ${Math.max(0, ...checked.map((c) => c.matches[0]?.similarity ?? 0))}` : ""}.`,
    checked_count: checked.length,
    duplicate_count: dups.length,
    threshold,
    candidates: checked,
  };
}

// ── 4. draft ─────────────────────────────────────────────────────────────

export const DRAFT_SYSTEM = `You write atomic notes for a knowledge vault from claims already vetted against six gates. Answer with JSON only.

For each claim you are given, EITHER write a note OR, when a listed vault match already makes the same assertion, record it as existing. When two claims make the same assertion, write ONE note and list both ids in merged_ids. Transform, do not harvest: a note copyable from the source is worthless, and a title that repeats a source sentence is rejected.

A note has:
- title: the claim as one declarative sentence, with no statistics in it (numbers belong in description and content).
- description: at most 200 characters; adds information beyond the title (what holds -> why -> so what). Never paraphrase the title.
- note_type, by what the note IS:
  CONCEPT an idea or relationship that explains something · OBSERVATION a finding about how things are, from evidence · PATTERN a recurring approach and when it works · DECISION a choice with its alternatives and why · PROCEDURE steps to do something · WORKFLOW how work moves between people or systems · ARCHITECTURE how a system is structured · INTEGRATION how two systems connect · BUG_PATTERN a recurring SOFTWARE defect with its root cause and fix (never a business problem) · REFERENCE facts to look up.
- content: the argument: mechanism, the source's evidence (quoted), when it holds and when it does not, what it lets a reader predict. Use real line breaks.
- topics: 1-4 names from the vault's list. A name means what its example note shows, not what the word could mean: do not tag a note with a topic whose example is about something else. Invent a name only when none fits.
- confidence: ${CONFIDENCE.join(" | ")} (grounded: the source demonstrates it).
- locus: where in the source it comes from.

Answer: {"notes":[{"candidate_id":"c1","merged_ids":["c3"],"title":"...","description":"...","note_type":"...","content":"...","topics":["..."],"confidence":"...","locus":"..."}],"existing":[{"candidate_id":"c2","note_id":"...","title":"...","reason":"..."}]}`;

function topicLines(bundle: Record<string, unknown>): string[] {
  const examples = arr(bundle.topic_examples).map(asRecord);
  const shown = new Set(examples.map((t) => str(t.name)));
  const rest = arr(bundle.topics).map(str).filter((t) => !shown.has(t));
  return [
    ...examples.map((t) => `- ${str(t.name)} (${str(t.notes)})${t.example ? `: e.g. "${str(t.example)}"` : ""}`),
    ...(rest.length ? [`- also: ${rest.slice(0, 150).join(", ")}`] : []),
  ];
}

export const OVERLAP_SYSTEM = `You compare drafted knowledge notes. Answer with JSON only.
Two notes are the SAME when a reader who accepted one would learn nothing new from the other: one assertion in different words, or one a restatement of the other's consequence. Related notes on one topic are NOT the same.
For each same pair, keep the note that states the claim more precisely.
Answer: {"same":[{"keep":"c1","drop":"c4","reason":"..."}]}  (an empty list when all differ)`;

export type DraftedNote = ProposedNote & { candidate_id: string; new_topics: string[] };
export type ConvergedClaim = { candidate_id: string; note_id: string; title: string; reason: string; locus: string; evidence: string };

const NOT_A_MATCH = "the note you named is not one of this claim's close matches in the vault (similarity at least 0.75, not archived, not replaced by another note): write the claim as a note";

export async function draftStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, checked: Record<string, unknown>, fetchImpl?: typeof fetch, windows?: TextWindow[]) {
  const candidates = arr(checked.candidates).map(asRecord);
  const vocabulary = new Set(arr(bundle.topics).map(str));
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const accepted: DraftedNote[] = [];
  const existing: ConvergedClaim[] = [];
  const rejected: { candidate_id: string; issues: string[] }[] = [];
  let rounds = 0;
  if (candidates.length === 0) {
    return { summary: "No candidates passed the gates, so no notes were drafted.", proposed_count: 0, existing_count: 0, rejected_count: 0, repair_rounds: 0, proposed: [], existing: [], rejected: [], overlaps: [], new_topics: [], cost_usd: 0, tokens: 0 };
  }

  /** One batch of claims from one window, drafted from that window's text, with one repair round. */
  async function draftBatch(batch: Record<string, unknown>[], w: TextWindow): Promise<void> {
    let pending = batch;
    let feedback = "";
    let batchRounds = 0;
    let failed: { candidate_id: string; issues: string[] }[] = [];
    const done = new Set<string>();
    while (pending.length && batchRounds < 2) {
      batchRounds++;
      const user = [
        `Source: ${str(bundle.title)}`,
        "Vault topics (name, notes, an example note):",
        ...topicLines(bundle),
        "",
        "Claims:",
        ...pending.map((c) => `- ${str(c.id)}: ${str(c.claim)}\n  locus: ${str(c.locus)}\n  evidence: ${str(c.evidence)}\n  vault matches: ${arr(c.matches).map(asRecord).map((m) => `${str(m.id)} "${str(m.title)}" (${str(m.similarity)})`).join("; ") || "none"}`),
        feedback,
        "",
        "Source text for evidence and conditions:",
        ...(w.heading ? [`Section: ${w.heading}`] : []),
        w.text,
      ].join("\n");
      const reply = await completeJson(llm, { model, system: DRAFT_SYSTEM, user, maxTokens: 24_000, reasoningEffort: "medium" }, fetchImpl);
      usage.prompt_tokens += reply.usage.prompt_tokens;
      usage.completion_tokens += reply.usage.completion_tokens;
      usage.cost += reply.usage.cost;
      const answer = asObject(reply.value, "The model's answer");
      failed = [];
      // "Already in the vault" holds only for a note this claim was actually matched with, live and not replaced.
      for (const e of arr(answer.existing).map(asRecord)) {
        const id = str(e.candidate_id);
        const candidate = pending.find((c) => str(c.id) === id);
        if (!candidate) continue;
        const match = arr(candidate.matches).map(asRecord).find((m) => str(m.id) === str(e.note_id));
        if (match?.eligible === true) {
          existing.push({ candidate_id: id, note_id: str(e.note_id), title: str(match.title) || str(e.title), reason: str(e.reason), locus: str(candidate.locus), evidence: str(candidate.evidence) });
          done.add(id);
        } else failed.push({ candidate_id: id, issues: [NOT_A_MATCH] });
      }
      const inBatch = new Set(batch.map((c) => str(c.id)));
      for (const raw of arr(answer.notes).map(asRecord)) {
        if (!inBatch.has(str(raw.candidate_id)) || done.has(str(raw.candidate_id))) continue;
        const note: Record<string, unknown> = { ...raw, note_type: str(raw.note_type).toUpperCase().replace(/-/g, "_") };
        const issues = checkProposal(note, accepted);
        if (/\d\s*(%|percent)|us\$|\$\s?\d/i.test(str(note.title))) issues.push("the title carries a statistic; state the claim the numbers support, and put the numbers in the description and content");
        if (containsVerbatim(str(bundle.text), str(note.title))) issues.push("the title repeats a sentence from the source; state the inference it supports in your own words");
        if (issues.length) {
          failed.push({ candidate_id: str(raw.candidate_id), issues });
          continue;
        }
        const topics = arr(note.topics).map(str).filter(Boolean);
        accepted.push({
          candidate_id: str(raw.candidate_id), title: str(note.title).trim(), description: str(note.description).trim(),
          note_type: note.note_type as ProposedNote["note_type"], content: str(note.content), topics,
          confidence: str(note.confidence) as ProposedNote["confidence"], locus: str(note.locus),
          new_topics: topics.filter((t) => !vocabulary.has(t)),
        });
        done.add(str(raw.candidate_id));
        for (const merged of arr(raw.merged_ids).map(str)) if (inBatch.has(merged)) done.add(merged);
      }
      const retry = new Set(failed.map((r) => r.candidate_id));
      pending = batch.filter((c) => retry.has(str(c.id)) && !done.has(str(c.id)));
      feedback = failed.length ? `\nYour previous drafts for these claims were rejected. Fix exactly these issues:\n${failed.map((r) => `- ${r.candidate_id}: ${r.issues.join("; ")}`).join("\n")}` : "";
    }
    rounds = Math.max(rounds, batchRounds);
    rejected.push(...failed.filter((r) => !done.has(r.candidate_id)));
    const reported = new Set(failed.map((r) => r.candidate_id));
    for (const c of batch) if (!done.has(str(c.id)) && !reported.has(str(c.id))) rejected.push({ candidate_id: str(c.id), issues: ["the model did not draft it"] });
  }

  // Each window's claims are drafted from that window's text alone, a batch at a time, so every call stays small.
  const byId = new Map((windows ?? []).map((w) => [w.id, w]));
  const whole: TextWindow = { id: "w0", heading: null, text: str(bundle.text) };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const c of candidates) {
    const key = byId.has(str(c.window)) ? str(c.window) : whole.id;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [key, group] of groups) {
    const size = draftBatchFor((await llm.active(fetchImpl)).locality);
    for (let i = 0; i < group.length; i += size) await draftBatch(group.slice(i, i + size), byId.get(key) ?? whole);
  }

  // Two drafts can make one assertion in different words (from one window or two); one short model call compares them all.
  const overlaps: { kept: string; dropped: string; reason: string }[] = [];
  let overlapCheck: "done" | "skipped" | "failed" = "skipped";
  if (accepted.length > 1) {
    // Best effort: a failed check keeps every draft and says so.
    const reply = await completeJson(llm, {
      model,
      system: OVERLAP_SYSTEM,
      user: accepted.map((n) => `${n.candidate_id}: ${n.title}\n  ${n.description}`).join("\n"),
      maxTokens: 8000,
      reasoningEffort: "low",
    }, fetchImpl).catch(() => null);
    if (reply) {
      overlapCheck = "done";
      usage.prompt_tokens += reply.usage.prompt_tokens;
      usage.completion_tokens += reply.usage.completion_tokens;
      usage.cost += reply.usage.cost;
      const ids = new Set(accepted.map((n) => n.candidate_id));
      const gone = new Set<string>();
      for (const pair of arr(asObject(reply.value, "The overlap check").same).map(asRecord)) {
        const keep = str(pair.keep);
        const drop = str(pair.drop);
        if (!ids.has(keep) || !ids.has(drop) || keep === drop || gone.has(keep) || gone.has(drop)) continue;
        gone.add(drop);
        overlaps.push({ kept: keep, dropped: drop, reason: str(pair.reason) });
      }
      for (let i = accepted.length - 1; i >= 0; i--) if (gone.has(accepted[i].candidate_id)) accepted.splice(i, 1);
    } else overlapCheck = "failed";
  }
  const newTopics = [...new Set(accepted.flatMap((n) => n.new_topics))];
  const merged = candidates.length - accepted.length - existing.length - rejected.length - overlaps.length;
  return {
    summary: `Drafted ${accepted.length} note${accepted.length === 1 ? "" : "s"}${existing.length ? `, ${existing.length} already in the vault` : ""}${merged > 0 ? `, ${merged} merged into others` : ""}${overlaps.length ? `, ${overlaps.length} dropped as the same assertion as another` : ""}${overlapCheck === "failed" ? " (the duplicate check between drafts did not run)" : ""}${rejected.length ? `, ${rejected.length} still failing the vault's rules after ${rounds} rounds` : ""}${newTopics.length ? `; new topics: ${newTopics.join(", ")}` : ""}.`,
    proposed_count: accepted.length,
    existing_count: existing.length,
    rejected_count: rejected.length,
    repair_rounds: rounds - 1,
    proposed: accepted,
    existing,
    rejected,
    overlaps,
    overlap_check: overlapCheck,
    new_topics: newTopics,
    cost_usd: round4(usage.cost),
    tokens: usage.prompt_tokens + usage.completion_tokens,
  };
}

// ── 5. report ────────────────────────────────────────────────────────────

export function reportStage(model: string, read: Record<string, unknown>, candidates: Record<string, unknown>, checked: Record<string, unknown>, draft: Record<string, unknown>) {
  const proposed = arr(draft.proposed).map(asRecord);
  const skipped = arr(candidates.skipped).map(asRecord);
  const existing = arr(draft.existing).map(asRecord);
  const rejected = arr(draft.rejected).map(asRecord);
  const restatements = Number(candidates.restatement_count ?? 0);
  const nonClaims = Number(candidates.non_claim_count ?? 0);
  const overlaps = arr(draft.overlaps).length;
  // Rejected on a gate, over distinct claims: restatements and non-claims are reported apart.
  const total = proposed.length + skipped.length + existing.length + rejected.length + overlaps;
  const skipRate = total ? skipped.length / total : 0;
  const cost = round4(Number(candidates.cost_usd ?? 0) + Number(draft.cost_usd ?? 0));
  const newTopics = arr(draft.new_topics).map(str);
  const otherGate = Number(candidates.other_gate_count ?? 0);
  const windowCount = Number(candidates.window_count ?? 0);
  const emptyParts = arr(candidates.empty_parts).map(str);
  const unreadableParts = arr(candidates.unreadable_parts).map(str);
  // Archived only when nothing survived, nothing was found in the vault, and every part said it holds no knowledge.
  const archiveReason = proposed.length === 0 && existing.length === 0 && str(candidates.source_kind) === "not_knowledge" ? str(candidates.source_kind_reason) || "it holds no claims by its nature" : null;
  const lines = [
    `## Extract — ${str(read.title)}`,
    "",
    `**${proposed.length} proposed** · ${skipped.length} rejected on a gate${otherGate ? ` (${otherGate} for a reason outside the gates)` : ""} · ${existing.length} already in the vault${rejected.length ? ` · ${rejected.length} failed the rules` : ""}${overlaps ? ` · ${overlaps} dropped as duplicates of another draft` : ""} · skip rate ${Math.round(skipRate * 100)}%`,
    `Also set aside: ${restatements} restatement${restatements === 1 ? "" : "s"} of kept claims, ${nonClaims} non-claim${nonClaims === 1 ? "" : "s"} (headings, captions, bare statistics). Neither counts in the skip rate.`,
    `Model \`${model}\` · $${cost.toFixed(4)} · ${Number(checked.checked_count ?? 0)} vault searches${windowCount > 1 ? ` · read in ${windowCount} parts` : ""}`,
    "",
  ];
  if (archiveReason) lines.push(`**Not knowledge:** ${archiveReason}. The source is archived rather than marked extracted.`, "");
  if (emptyParts.length) lines.push(`Parts that yielded nothing: ${emptyParts.join(", ")}.`, "");
  if (unreadableParts.length) lines.push(`Parts the model could not read: ${unreadableParts.join(", ")}.`, "");
  if (proposed.length) {
    lines.push("### Proposed notes", "");
    proposed.forEach((n, i) => lines.push(`${i + 1}. **${str(n.title)}** — _${str(n.note_type).toLowerCase()}, ${str(n.confidence)}_`, `   ${str(n.description)}`, `   Topics: ${arr(n.topics).map(str).join(", ")} · From: ${str(n.locus)}`));
    lines.push("");
  }
  if (existing.length) lines.push("### Already in the vault (now also linked to this source)", "", ...existing.map((e) => `- ${str(e.title)} (\`${str(e.note_id)}\`) — ${str(e.reason)}`), "");
  if (skipped.length) lines.push("### Rejected on a gate", "", "| Candidate | Gate | Why |", "|---|---|---|", ...skipped.map((s) => `| ${cell(str(s.candidate))} | ${str(s.gate)} | ${cell(str(s.reason))} |`), "");
  if (newTopics.length) lines.push(`New topics not in the vault's vocabulary: ${newTopics.join(", ")} — review before writing.`, "");
  return {
    summary: `${proposed.length} notes proposed, ${skipped.length} rejected, ${existing.length} already in the vault, skip rate ${Math.round(skipRate * 100)}% (plus ${restatements} restatements and ${nonClaims} non-claims set aside), $${cost.toFixed(4)}.${archiveReason ? ` Archived: ${archiveReason}.` : ""}`,
    report: lines.join("\n"),
    dry_run: true,
    source_id: str(read.source_id),
    proposed_count: proposed.length,
    skipped_count: skipped.length,
    restatement_count: restatements,
    non_claim_count: nonClaims,
    existing_count: existing.length,
    skip_rate: Math.round(skipRate * 100) / 100,
    cost_usd: cost,
    new_topics: newTopics,
    other_gate_count: otherGate,
    window_count: windowCount,
    empty_parts: emptyParts,
    unreadable_parts: unreadableParts,
    archive_reason: archiveReason,
    proposed: proposed.map((n) => ({ title: str(n.title), description: str(n.description), note_type: str(n.note_type), topics: arr(n.topics).map(str) })),
  };
}
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);
