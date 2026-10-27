/**
 * Bounded candidates (M0 scale fix): rank documents for a request from
 * their names alone (drive nodes plus known titles) and the recent ring,
 * never from every document's state. M1 adds a server semantic search
 * merged under a deadline; the cap stays at 10 per ref path.
 */
import type { CandidateDoc } from "./context-frame.js";

export const CANDIDATE_CAP = 10;

export const STOPWORDS = new Set(
  "a an and are as at be by for from in into is it its of on or the this that to with my me our".split(
    " ",
  ),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Shared-prefix match, so "hive" meets "hives" and "beehive" does not. */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  return n >= 4 && a.slice(0, n) === b.slice(0, n) && Math.abs(a.length - b.length) <= 2;
}

/** How well a document's names match a request: shared words, best name. */
export function lexicalScore(utterance: string, d: CandidateDoc): number {
  const u = tokens(utterance);
  let best = 0;
  for (const name of [d.title, ...(d.aliases ?? [])]) {
    const t = [...new Set(tokens(name))];
    if (t.length === 0) continue;
    const hit = t.filter((w) => u.some((x) => close(x, w))).length;
    // whole-name hits rank above partial ones of equal size
    best = Math.max(best, hit + (hit === t.length ? 0.5 : 0));
  }
  return best;
}

export interface RankOptions {
  /** Most recent first; a recent document wins ties. */
  recentIds?: string[];
  cap?: number;
}

/**
 * The top `cap` documents for a request: lexical score, then recency, then
 * title. With no words in common the recent ring orders the list.
 */
export function rankCandidates(
  utterance: string,
  docs: CandidateDoc[],
  opts: RankOptions = {},
): CandidateDoc[] {
  const recent = opts.recentIds ?? [];
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return docs
    .map((d) => ({ d, s: lexicalScore(utterance, d), r: rank(d.id) }))
    .sort((a, b) => b.s - a.s || a.r - b.r || a.d.title.localeCompare(b.d.title))
    .slice(0, opts.cap ?? CANDIDATE_CAP)
    .map((x) => x.d);
}

/** Every string anywhere in a state object (ids a document already refers to). */
export function referencedIds(state: unknown, out = new Set<string>()): Set<string> {
  if (typeof state === "string") out.add(state);
  else if (Array.isArray(state)) for (const v of state) referencedIds(v, out);
  else if (typeof state === "object" && state !== null)
    for (const v of Object.values(state)) referencedIds(v, out);
  return out;
}
