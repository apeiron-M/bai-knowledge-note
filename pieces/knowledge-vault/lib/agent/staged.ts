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

export type SourceBundle = {
  source_id: string;
  title: string;
  source_type: string | null;
  chars: number;
  text: string;
  figures: number;
  topics: string[];
};

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
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── 1. read ──────────────────────────────────────────────────────────────

export async function readSourceStage(client: KnowledgeVaultClient, drive: string, sourceId: string): Promise<SourceBundle & { summary: string }> {
  const doc = await client.request<{ name: string; state?: { global?: { title?: string; content?: string; sourceType?: string; attachments?: unknown[] } } }>({ path: `notes/${encodeURIComponent(sourceId)}`, query: { drive } });
  const g = doc.state?.global ?? {};
  const content = g.content ?? "";
  const topicsBody = await client.request<{ topics?: { name: string; noteCount: number }[] } | { name: string; noteCount: number }[]>({ path: "topics", query: { drive } });
  const topics = (Array.isArray(topicsBody) ? topicsBody : (topicsBody.topics ?? [])).sort((a, b) => b.noteCount - a.noteCount).map((t) => t.name);
  const figures = arr(g.attachments).length;
  const title = g.title ?? doc.name;
  if (!content.trim()) throw new KnowledgeVaultApiError(`The source "${title}" has no text to extract from`, { category: "validation" });
  const text = content.length > MAX_SOURCE_CHARS ? content.slice(0, MAX_SOURCE_CHARS) : content;
  return {
    summary: `Read "${title}": ${content.length.toLocaleString("en")} characters${content.length > MAX_SOURCE_CHARS ? ` (first ${MAX_SOURCE_CHARS.toLocaleString("en")} used)` : ""}, ${figures} figure${figures === 1 ? "" : "s"} (not readable by the model), ${topics.length} vault topics.`,
    source_id: sourceId,
    title,
    source_type: g.sourceType ?? null,
    chars: content.length,
    text,
    figures,
    topics,
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

Answer: {"kept":[{"claim":"...","locus":"section and paragraph","evidence":"the source's own words that support it","disagreement":"what a practitioner who disagrees would argue"}],"skipped":[{"candidate":"...","gate":"${GATES.join("|")}","reason":"..."}]}`;

export async function candidatesStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, fetchImpl?: typeof fetch) {
  const { value, usage } = await completeJson(llm, {
    model,
    system: CANDIDATES_SYSTEM,
    user: `Source title: ${str(bundle.title)}\n\n${str(bundle.text)}`,
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
  const gates = countBy(skipped.map((s) => s.gate));
  return {
    summary: `${kept.length + skipped.length} candidates: ${kept.length} pass all six gates, ${skipped.length} struck${skipped.length ? ` (${Object.entries(gates).map(([g, n]) => `${n} ${g}`).join(", ")})` : ""}.`,
    kept_count: kept.length,
    skipped_count: skipped.length,
    kept,
    skipped,
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
function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

// ── 3. vault check ───────────────────────────────────────────────────────

export async function checkVaultStage(client: KnowledgeVaultClient, drive: string, candidates: Record<string, unknown>, threshold = 0.9) {
  const kept = arr(candidates.kept).map(asRecord);
  const checked: CheckedCandidate[] = [];
  for (const c of kept) {
    const body = await client.request<{ hits: { node: { documentId?: string; title?: string; status?: string }; similarity: number }[] }>({
      path: "search",
      query: { drive, q: str(c.claim), mode: "semantic", limit: 3, related: 0 },
    });
    const matches = body.hits.filter((h) => h.node.status !== "MOC").map((h) => ({ id: str(h.node.documentId), title: str(h.node.title), similarity: Math.round(h.similarity * 1000) / 1000 }));
    checked.push({ id: str(c.id), claim: str(c.claim), locus: str(c.locus), evidence: str(c.evidence), matches, likely_duplicate: (matches[0]?.similarity ?? 0) >= threshold });
  }
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
- note_type: one of ${NOTE_TYPES.join(", ")}.
- content: the argument: mechanism, the source's evidence (quoted), when it holds and when it does not, what it lets a reader predict. Use real line breaks.
- topics: 1-4 names; use the vault's topic list; invent one only when none fits.
- confidence: ${CONFIDENCE.join(" | ")} (grounded: the source demonstrates it).
- locus: where in the source it comes from.

Answer: {"notes":[{"candidate_id":"c1","merged_ids":["c3"],"title":"...","description":"...","note_type":"...","content":"...","topics":["..."],"confidence":"...","locus":"..."}],"existing":[{"candidate_id":"c2","note_id":"...","title":"...","reason":"..."}]}`;

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
    return { summary: "No candidates passed the gates, so no notes were drafted.", proposed_count: 0, existing_count: 0, rejected_count: 0, repair_rounds: 0, proposed: [], existing: [], rejected: [], new_topics: [], cost_usd: 0, tokens: 0 };
  }

  let pending = candidates;
  let feedback = "";
  while (pending.length && rounds < 2) {
    rounds++;
    const user = [
      `Source: ${str(bundle.title)}`,
      `Vault topics: ${[...vocabulary].slice(0, 150).join(", ")}`,
      "",
      "Claims:",
      ...pending.map((c) => `- ${str(c.id)}: ${str(c.claim)}\n  locus: ${str(c.locus)}\n  evidence: ${str(c.evidence)}\n  vault matches: ${arr(c.matches).map(asRecord).map((m) => `${str(m.id)} "${str(m.title)}" (${str(m.similarity)})`).join("; ") || "none"}`),
      feedback,
      "",
      "Source text for evidence and conditions:",
      str(bundle.text),
    ].join("\n");
    const reply = await completeJson(llm, { model, system: DRAFT_SYSTEM, user, maxTokens: 12_000 }, fetchImpl);
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
  const newTopics = [...new Set(accepted.flatMap((n) => n.new_topics))];
  const merged = candidates.length - accepted.length - existing.length - rejected.length;
  return {
    summary: `Drafted ${accepted.length} note${accepted.length === 1 ? "" : "s"}${existing.length ? `, ${existing.length} already in the vault` : ""}${merged > 0 ? `, ${merged} merged into others` : ""}${rejected.length ? `, ${rejected.length} still failing the vault's rules after ${rounds} rounds` : ""}${newTopics.length ? `; new topics: ${newTopics.join(", ")}` : ""}.`,
    proposed_count: accepted.length,
    existing_count: existing.length,
    rejected_count: rejected.length,
    repair_rounds: rounds - 1,
    proposed: accepted,
    existing,
    rejected,
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
  const total = proposed.length + skipped.length + existing.length + rejected.length;
  const skipRate = total ? skipped.length / total : 0;
  const cost = round4(Number(candidates.cost_usd ?? 0) + Number(draft.cost_usd ?? 0));
  const newTopics = arr(draft.new_topics).map(str);
  const lines = [
    `## Extract (dry run) — ${str(read.title)}`,
    "",
    `**${proposed.length} proposed** · ${skipped.length} skipped · ${existing.length} already in the vault${rejected.length ? ` · ${rejected.length} failed the rules` : ""} · skip rate ${Math.round(skipRate * 100)}%`,
    `Model \`${model}\` · $${cost.toFixed(4)} · ${Number(checked.checked_count ?? 0)} vault searches`,
    "",
  ];
  if (proposed.length) {
    lines.push("### Proposed notes", "");
    proposed.forEach((n, i) => lines.push(`${i + 1}. **${str(n.title)}** — _${str(n.note_type).toLowerCase()}, ${str(n.confidence)}_`, `   ${str(n.description)}`, `   Topics: ${arr(n.topics).map(str).join(", ")} · From: ${str(n.locus)}`));
    lines.push("");
  }
  if (existing.length) lines.push("### Already in the vault", "", ...existing.map((e) => `- ${str(e.title)} (\`${str(e.note_id)}\`) — ${str(e.reason)}`), "");
  if (skipped.length) lines.push("### Skipped", "", "| Candidate | Gate | Why |", "|---|---|---|", ...skipped.map((s) => `| ${cell(str(s.candidate))} | ${str(s.gate)} | ${cell(str(s.reason))} |`), "");
  if (newTopics.length) lines.push(`New topics not in the vault's vocabulary: ${newTopics.join(", ")} — review before writing.`, "");
  return {
    summary: `${proposed.length} notes proposed, ${skipped.length} skipped, ${existing.length} already in the vault, skip rate ${Math.round(skipRate * 100)}%, $${cost.toFixed(4)}.`,
    report: lines.join("\n"),
    dry_run: true,
    source_id: str(read.source_id),
    proposed_count: proposed.length,
    skipped_count: skipped.length,
    existing_count: existing.length,
    skip_rate: Math.round(skipRate * 100) / 100,
    cost_usd: cost,
    new_topics: newTopics,
    proposed: proposed.map((n) => ({ title: str(n.title), description: str(n.description), note_type: str(n.note_type), topics: arr(n.topics).map(str) })),
  };
}
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);
