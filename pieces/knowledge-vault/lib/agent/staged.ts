import type { KnowledgeVaultClient } from "../common/client.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { checkProposal, CONFIDENCE, GATES, NOTE_TYPES, type ProposedNote, type SkippedCandidate } from "./extract.js";
import { completeJson, type LlmClient, type Usage } from "./llm.js";

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
export type VaultMatch = { id: string; title: string; similarity: number };
export type CheckedCandidate = Candidate & { matches: VaultMatch[]; likely_duplicate: boolean };

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

export const CANDIDATES_SYSTEM = `You find atomic knowledge claims in ONE source for a knowledge vault. Answer with JSON only.

List every candidate claim in the source, in your own words, then run six gates on each. A claim passes only if all six hold:
1 sentence: completes "This note argues that ...". Not a label, heading or caption.
2 transclusion: works as a clause: "Since [claim], it follows that ...". Not a question.
3 falsifiability: a competent practitioner could disagree. "Quality matters" fails.
4 coherence: statable in 1-3 sentences without "and also"; bundles are several candidates.
5 independence: holds for a reader who never saw the source.
6 non_attribution: asserts what is TRUE, not what someone said.
Not claims: excerpts, summaries, headings, captions, anecdotes (they are evidence), bare numbers, restated structure, definitions with no stake.
Conditions travel inside the claim ("X improves Y only when Z").
Two candidates that make the same assertion: keep one, strike the other as "duplicate".

Zero survivors is a valid answer for a foreword or glossary; a high skip rate is a finding.

A kept claim is the INFERENCE a finding supports, never the finding restated: "74% invest over $50m" is evidence; "once spend is that high, budget no longer separates organizations" is a claim. Never copy a source sentence as the claim.
For each kept claim, say what a competent practitioner who disagrees would argue. If you cannot, the claim fails falsifiability: strike it.

List only statements. Leave out headings, survey questions, figure captions and name credits entirely; count them in "non_claims".

Answer: {"non_claims":0,"kept":[{"claim":"...","locus":"section and paragraph","evidence":"the source's own words that support it","disagreement":"what a practitioner who disagrees would argue"}],"skipped":[{"candidate":"...","gate":"${GATES.join("|")}","reason":"..."}]}`;

export async function candidatesStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, fetchImpl?: typeof fetch) {
  const { value, usage } = await completeJson(llm, {
    model,
    system: CANDIDATES_SYSTEM,
    user: `Source title: ${str(bundle.title)}\n\n${str(bundle.text)}`,
    // Listing candidates needs little deliberation; unbounded reasoning took 45-180 s here.
    reasoningEffort: "low",
  }, fetchImpl);
  const answer = asObject(value, "The model's answer");
  const skipped: SkippedCandidate[] = [];
  const kept: Candidate[] = [];
  for (const c of arr(answer.kept).map((x) => asRecord(x))) {
    const claim = str(c.claim).trim();
    if (!claim) continue;
    // The gates the model tends to wave through, enforced here.
    if (BARE_STATISTIC.test(claim)) skipped.push({ candidate: claim, gate: "falsifiability", reason: "A bare statistic: evidence for a claim, not a claim (struck by the harness)" });
    else if (!str(c.disagreement).trim()) skipped.push({ candidate: claim, gate: "falsifiability", reason: "No position a practitioner could take against it (struck by the harness)" });
    else if (containsVerbatim(str(bundle.text), claim)) skipped.push({ candidate: claim, gate: "sentence", reason: "Copied from the source rather than stated as the inference it supports (struck by the harness)" });
    else kept.push({ id: `c${kept.length + 1}`, claim, locus: str(c.locus), evidence: str(c.evidence) });
  }
  skipped.push(...arr(answer.skipped)
    .map((c) => asRecord(c))
    .filter((c) => str(c.candidate).trim())
    .map((c) => ({ candidate: str(c.candidate), gate: (GATES as readonly string[]).includes(str(c.gate)) ? (str(c.gate) as SkippedCandidate["gate"]) : "coherence", reason: str(c.reason) })));
  const breakdown = classifySkips(skipped);
  const nonClaims = Math.max(0, Math.round(Number(answer.non_claims) || 0)) + breakdown.not_a_claim.length;
  const distinct = kept.length + breakdown.rejected.length;
  return {
    summary: `${distinct} distinct claim${distinct === 1 ? "" : "s"}: ${kept.length} kept, ${breakdown.rejected.length} rejected on a gate${breakdown.restatement.length ? `; ${breakdown.restatement.length} restatements of kept claims` : ""}${nonClaims ? `; ${nonClaims} non-claims (headings, captions, bare statistics)` : ""}.`,
    kept_count: kept.length,
    skipped_count: breakdown.rejected.length,
    restatement_count: breakdown.restatement.length,
    non_claim_count: nonClaims,
    kept,
    skipped: breakdown.rejected,
    restatements: breakdown.restatement,
    non_claims: breakdown.not_a_claim,
    cost_usd: round4(usage.cost),
    tokens: usage.prompt_tokens + usage.completion_tokens,
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

export async function checkVaultStage(client: KnowledgeVaultClient, drive: string, candidates: Record<string, unknown>, threshold = 0.9) {
  const kept = arr(candidates.kept).map(asRecord);
  // In parallel: a semantic search embeds its query, 3-4 s each on a remote vault.
  const checked: CheckedCandidate[] = await mapLimit(kept, 4, async (c) => {
    const body = await client.request<{ hits: { node: { documentId?: string; title?: string; status?: string }; similarity: number }[] }>({
      path: "search",
      query: { drive, q: str(c.claim), mode: "semantic", limit: 3, related: 0 },
    });
    const matches = body.hits.filter((h) => h.node.status !== "MOC").map((h) => ({ id: str(h.node.documentId), title: str(h.node.title), similarity: Math.round(h.similarity * 1000) / 1000 }));
    return { id: str(c.id), claim: str(c.claim), locus: str(c.locus), evidence: str(c.evidence), matches, likely_duplicate: (matches[0]?.similarity ?? 0) >= threshold };
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

export async function draftStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, checked: Record<string, unknown>, fetchImpl?: typeof fetch) {
  const candidates = arr(checked.candidates).map(asRecord);
  const vocabulary = new Set(arr(bundle.topics).map(str));
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const accepted: DraftedNote[] = [];
  const existing: { candidate_id: string; note_id: string; title: string; reason: string }[] = [];
  let rounds = 0;
  let rejected: { candidate_id: string; issues: string[] }[] = [];
  if (candidates.length === 0) {
    return { summary: "No candidates passed the gates, so no notes were drafted.", proposed_count: 0, existing_count: 0, rejected_count: 0, repair_rounds: 0, proposed: [], existing: [], rejected: [], overlaps: [], new_topics: [], cost_usd: 0, tokens: 0 };
  }

  let pending = candidates;
  let feedback = "";
  while (pending.length && rounds < 2) {
    rounds++;
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
      str(bundle.text),
    ].join("\n");
    const reply = await completeJson(llm, { model, system: DRAFT_SYSTEM, user, maxTokens: 24_000, reasoningEffort: "medium" }, fetchImpl);
    usage.prompt_tokens += reply.usage.prompt_tokens;
    usage.completion_tokens += reply.usage.completion_tokens;
    usage.cost += reply.usage.cost;
    const answer = asObject(reply.value, "The model's answer");
    for (const e of arr(answer.existing).map(asRecord)) existing.push({ candidate_id: str(e.candidate_id), note_id: str(e.note_id), title: str(e.title), reason: str(e.reason) });
    rejected = [];
    const done = new Set(existing.map((e) => e.candidate_id));
    for (const raw of arr(answer.notes).map(asRecord)) {
      const note: Record<string, unknown> = { ...raw, note_type: str(raw.note_type).toUpperCase().replace(/-/g, "_") };
      const issues = checkProposal(note, accepted);
      if (/\d\s*(%|percent)|us\$|\$\s?\d/i.test(str(note.title))) issues.push("the title carries a statistic; state the claim the numbers support, and put the numbers in the description and content");
      if (containsVerbatim(str(bundle.text), str(note.title))) issues.push("the title repeats a sentence from the source; state the inference it supports in your own words");
      if (issues.length) {
        rejected.push({ candidate_id: str(raw.candidate_id), issues });
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
      for (const merged of arr(raw.merged_ids).map(str)) done.add(merged);
    }
    const retry = new Set(rejected.map((r) => r.candidate_id));
    pending = candidates.filter((c) => retry.has(str(c.id)) && !done.has(str(c.id)));
    feedback = rejected.length ? `\nYour previous drafts for these claims were rejected. Fix exactly these issues:\n${rejected.map((r) => `- ${r.candidate_id}: ${r.issues.join("; ")}`).join("\n")}` : "";
  }
  // Two drafts can make one assertion in different words; a lexical check
  // misses that, so one short model call compares them.
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
  const lines = [
    `## Extract — ${str(read.title)}`,
    "",
    `**${proposed.length} proposed** · ${skipped.length} rejected on a gate · ${existing.length} already in the vault${rejected.length ? ` · ${rejected.length} failed the rules` : ""}${overlaps ? ` · ${overlaps} dropped as duplicates of another draft` : ""} · skip rate ${Math.round(skipRate * 100)}%`,
    `Also set aside: ${restatements} restatement${restatements === 1 ? "" : "s"} of kept claims, ${nonClaims} non-claim${nonClaims === 1 ? "" : "s"} (headings, captions, bare statistics). Neither counts in the skip rate.`,
    `Model \`${model}\` · $${cost.toFixed(4)} · ${Number(checked.checked_count ?? 0)} vault searches`,
    "",
  ];
  if (proposed.length) {
    lines.push("### Proposed notes", "");
    proposed.forEach((n, i) => lines.push(`${i + 1}. **${str(n.title)}** — _${str(n.note_type).toLowerCase()}, ${str(n.confidence)}_`, `   ${str(n.description)}`, `   Topics: ${arr(n.topics).map(str).join(", ")} · From: ${str(n.locus)}`));
    lines.push("");
  }
  if (existing.length) lines.push("### Already in the vault", "", ...existing.map((e) => `- ${str(e.title)} (\`${str(e.note_id)}\`) — ${str(e.reason)}`), "");
  if (skipped.length) lines.push("### Rejected on a gate", "", "| Candidate | Gate | Why |", "|---|---|---|", ...skipped.map((s) => `| ${cell(str(s.candidate))} | ${str(s.gate)} | ${cell(str(s.reason))} |`), "");
  if (newTopics.length) lines.push(`New topics not in the vault's vocabulary: ${newTopics.join(", ")} — review before writing.`, "");
  return {
    summary: `${proposed.length} notes proposed, ${skipped.length} rejected, ${existing.length} already in the vault, skip rate ${Math.round(skipRate * 100)}% (plus ${restatements} restatements and ${nonClaims} non-claims set aside), $${cost.toFixed(4)}.`,
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
    proposed: proposed.map((n) => ({ title: str(n.title), description: str(n.description), note_type: str(n.note_type), topics: arr(n.topics).map(str) })),
  };
}
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);
