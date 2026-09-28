import { randomUUID } from "node:crypto";
import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage } from "../common/errors.js";
import { checkProposal } from "./extract.js";
import { completeJson, type LlmClient } from "./llm.js";

/**
 * Verify: the pipeline's fourth phase for one source's notes. Deterministic
 * checks (the note rules, links, provenance, MoC membership), a duplicate
 * check against the whole vault, and a recite test by the model. Findings
 * are reported, never rewritten: a person decides. A confirmed duplicate is
 * retired the way the vault retires one while it is still in review: the
 * surviving note SUPERSEDES it (with the reason on the edge) and the
 * duplicate is rejected back to DRAFT with a comment. Nothing is approved
 * and the task stays at verify, whose advance completes it after review.
 */

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

type Edge = { direction?: string; documentId?: string; linkType?: string; reason?: string | null; title?: string | null };
export type VerifyNote = {
  id: string;
  title: string;
  description: string;
  note_type: string;
  content: string;
  topics: string[];
  status: string;
  origin: string | null;
  edges: Edge[];
};

const KNOWLEDGE = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"]);

export async function readVerifyNotes(client: KnowledgeVaultClient, drive: string, sourceId: string) {
  const src = await client.request<{ name: string; state?: { global?: { title?: string; status?: string; extractedClaims?: unknown[] } } }>({ path: `notes/${encodeURIComponent(sourceId)}`, query: { drive } });
  const title = src.state?.global?.title ?? src.name;
  const ids = arr(src.state?.global?.extractedClaims).map((c) => (typeof c === "string" ? c : str(rec(c).claimRef))).filter(Boolean);
  const notes: VerifyNote[] = [];
  for (const id of ids) {
    const doc = await client.request<{ name?: string; state?: { global?: Record<string, unknown> }; edges?: Edge[] }>({ path: `notes/${encodeURIComponent(id)}`, query: { drive } });
    const g = doc.state?.global ?? {};
    if (g.status === "ARCHIVED") continue;
    notes.push({
      id,
      title: str(g.title) || str(doc.name) || id,
      description: str(g.description),
      note_type: str(g.noteType),
      content: str(g.content),
      topics: arr(g.topics).map((t) => str(rec(t).name)).filter(Boolean),
      status: str(g.status),
      origin: str(rec(g.provenance).sourceOrigin) || null,
      edges: doc.edges ?? [],
    });
  }
  return { sourceTitle: title, sourceStatus: src.state?.global?.status ?? null, notes };
}

/** The checks that need no model: the note rules, its links, its provenance, its MoC. */
export function checkNote(note: VerifyNote, sourceId: string): string[] {
  const issues = checkProposal({ title: note.title, description: note.description, note_type: note.note_type, content: note.content, topics: note.topics, confidence: "grounded", locus: "-" }, []);
  const knowledge = note.edges.filter((e) => KNOWLEDGE.has(str(e.linkType)));
  if (knowledge.length < 2) issues.push(`only ${knowledge.length} link${knowledge.length === 1 ? "" : "s"} to other notes; the vault wants at least 2`);
  if (!knowledge.some((e) => e.direction === "in")) issues.push("no other note links to it (orphan)");
  const bare = knowledge.filter((e) => !str(e.reason).trim()).length;
  if (bare) issues.push(`${bare} link${bare === 1 ? " has" : "s have"} no reason`);
  if (!note.edges.some((e) => e.linkType === "DERIVED_FROM" && e.direction === "out" && e.documentId === sourceId)) issues.push("no DERIVED_FROM link to its source");
  if (!note.edges.some((e) => e.linkType === "CORE_IDEA" && e.direction === "in")) issues.push("not in any MoC");
  if (note.origin !== "DERIVED") issues.push("provenance is not DERIVED");
  return issues;
}

type Similar = { similarity?: number; node?: { documentId?: string; title?: string; description?: string; status?: string } };
export type DuplicateCandidate = { id: string; title: string; description: string; similarity: number; sibling: boolean };

/** Near neighbours worth asking about: a paraphrase of one finding scored 0.84–0.89 here, below extract's 0.9. */
export async function duplicateCandidates(client: KnowledgeVaultClient, drive: string, notes: VerifyNote[], floor = 0.8) {
  const siblings = new Set(notes.map((n) => n.id));
  const out: Record<string, DuplicateCandidate[]> = {};
  for (const n of notes) {
    const rows = await client.request<Similar[]>({ path: `notes/${encodeURIComponent(n.id)}/similar`, query: { drive, limit: 6 } }).catch(() => []);
    out[n.id] = rows
      .map((r) => ({ id: str(r.node?.documentId), title: str(r.node?.title), description: str(r.node?.description), status: r.node?.status, similarity: typeof r.similarity === "number" ? Math.round(r.similarity * 1000) / 1000 : 0 }))
      .filter((c) => c.id && c.id !== n.id && c.status !== "MOC" && c.status !== "ARCHIVED" && c.similarity >= floor)
      .map(({ status: _s, ...c }) => ({ ...c, sibling: siblings.has(c.id) }));
  }
  return out;
}

export const VERIFY_SYSTEM = `You review atomic knowledge notes before a person approves them. Answer with JSON only.

For each NOTE:
1. Recite test: from the title alone, could a reader say what the note claims? Does the description add information beyond the title? Does the content argue the claim (mechanism, evidence, conditions) rather than restate it? Does the note type fit? Is it ONE claim?
   Flag a note whose claim is only a finding restated as a sentence: a survey figure, a percentage, or a comparison with an average ("X are more likely than the global average to ...") with no inference a practitioner could act on or dispute. A finding is evidence for a claim, not a claim.
   verdict "pass" or "flag", and for "flag" the specific problems.
2. Duplicates: for each listed candidate, is it the SAME assertion (a reader who accepted one learns nothing new from the other), not merely the same topic? Name only true duplicates.

Answer: {"notes":[{"id":"...","verdict":"pass","problems":[],"duplicate_of":"<candidate id or empty>","duplicate_reason":"why they are the same assertion"}]}`;

export type NoteVerdict = { id: string; verdict: "pass" | "flag"; problems: string[]; duplicate_of: string | null; duplicate_reason: string };

export async function judgeStage(llm: LlmClient, model: string, notes: VerifyNote[], candidates: Record<string, DuplicateCandidate[]>, fetchImpl?: typeof fetch) {
  const batches: VerifyNote[][] = [];
  for (let i = 0; i < notes.length; i += 3) batches.push(notes.slice(i, i + 3));
  const replies = await Promise.all(batches.map((batch) => completeJson(llm, {
    model,
    system: VERIFY_SYSTEM,
    user: batch.map((n) => [
      `NOTE ${n.id} (${n.note_type || "no type"})`,
      `  title: ${n.title}`,
      `  description: ${n.description}`,
      `  content: ${n.content.slice(0, 2500)}`,
      "  duplicate candidates:",
      ...((candidates[n.id] ?? []).length ? (candidates[n.id] ?? []).map((c) => `  - ${c.id} (${c.similarity}): ${c.title} — ${c.description}`) : ["  (none)"]),
    ].join("\n")).join("\n\n"),
    maxTokens: 16_000,
    reasoningEffort: "low",
  }, fetchImpl)));
  const ids = new Set(notes.map((n) => n.id));
  const verdicts = new Map<string, NoteVerdict>();
  let cost = 0;
  for (const { value, usage } of replies) {
    cost += usage.cost;
    for (const raw of arr(rec(value).notes).map(rec)) {
      const id = str(raw.id);
      if (!ids.has(id)) continue;
      const dup = str(raw.duplicate_of);
      const allowed = new Set((candidates[id] ?? []).map((c) => c.id));
      verdicts.set(id, {
        id,
        verdict: raw.verdict === "flag" ? "flag" : "pass",
        problems: arr(raw.problems).map(str).filter(Boolean),
        duplicate_of: dup && allowed.has(dup) ? dup : null,
        duplicate_reason: str(raw.duplicate_reason),
      });
    }
  }
  return { verdicts, cost };
}

export type Retirement = { duplicate: string; survivor: string; survivor_title: string; reason: string };

/**
 * Which note survives each duplicate pair: a note from outside this source
 * (it was there first); between two of this source's notes, the earlier one.
 * A pair is retired once, and never both ways.
 */
export function planRetirements(notes: VerifyNote[], verdicts: Map<string, NoteVerdict>, candidates: Record<string, DuplicateCandidate[]>): Retirement[] {
  const order = new Map(notes.map((n, i) => [n.id, i]));
  const retired = new Set<string>();
  const out: Retirement[] = [];
  for (const n of notes) {
    const v = verdicts.get(n.id);
    if (!v?.duplicate_of || retired.has(n.id)) continue;
    const other = (candidates[n.id] ?? []).find((c) => c.id === v.duplicate_of);
    if (!other) continue;
    let duplicate = n.id;
    let survivor = other.id;
    if (other.sibling && (order.get(other.id) ?? 0) > (order.get(n.id) ?? 0)) [duplicate, survivor] = [other.id, n.id];
    if (retired.has(duplicate) || retired.has(survivor)) continue;
    retired.add(duplicate);
    const survivorTitle = survivor === n.id ? n.title : other.title;
    out.push({ duplicate, survivor, survivor_title: survivorTitle, reason: v.duplicate_reason || "the same assertion" });
  }
  return out;
}

export async function retireStage(client: KnowledgeVaultClient, args: { retirements: Retirement[]; titles: Map<string, string>; actor: string; now?: () => Date }) {
  const at = (args.now ?? (() => new Date()))().toISOString();
  const done: Retirement[] = [];
  const problems: string[] = [];
  for (const r of args.retirements) {
    try {
      await client.request({ method: "POST", path: "relationships", json: { source: r.survivor, target: r.duplicate, type: "SUPERSEDES", reason: `"${r.survivor_title}" already makes this claim: ${r.reason}`.slice(0, 900), confidence: "established" } });
      const result = await client.request<{ operations: { type: string; error?: string | null }[] }>({
        method: "POST",
        path: "actions",
        json: { documentId: r.duplicate, actions: [{ type: "REJECT_NOTE", input: { id: randomUUID(), actor: args.actor, timestamp: at, comment: `Duplicate of "${r.survivor_title}" (${r.survivor}): ${r.reason}` } }] },
      });
      const failed = result.operations.find((o) => o.error);
      if (failed) problems.push(`"${args.titles.get(r.duplicate) ?? r.duplicate}": ${failed.error}`);
      else done.push(r);
    } catch (error) {
      problems.push(`"${args.titles.get(r.duplicate) ?? r.duplicate}": ${errorMessage(error)}`);
    }
  }
  return {
    summary: `Retired ${done.length} duplicate${done.length === 1 ? "" : "s"} (SUPERSEDES from the surviving note, rejected back to DRAFT with a comment)${problems.length ? `; ${problems.length} could not be retired` : ""}.`,
    retired: done,
    problems,
  };
}
