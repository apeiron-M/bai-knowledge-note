/**
 * Whole-list fields completed from the document's current list (X9). Some
 * ops replace a list with their input, so a partial list from the model
 * silently deletes what it left out: REORDER_CORE_IDEAS keeps only the ids
 * it is given, SET_REFERENCES only the URLs.
 */

/**
 * `order`: the input is a new order of the current items; ones the model
 * left out keep their relative order after the ones it placed.
 * `keep`: the input is a new list; when the request adds to it ("also",
 * "too", "don't lose") rather than replacing it, the current entries stay.
 */
export type ListMode = "order" | "keep";

export interface CurrentList {
  mode: ListMode;
  values: string[];
}

const ADD_CUES = [
  "also",
  "too",
  "alongside",
  "add",
  "adding",
  "append",
  "plus",
  "keep",
  "additionally",
  "another",
  "as well",
  "in addition",
  "along with",
  "together with",
  "don't lose",
  "don't drop",
  "do not lose",
  "do not drop",
];
const REPLACE_CUES = [
  "only",
  "just",
  "replace",
  "replacing",
  "swap",
  "instead",
  "remove",
  "drop",
  "clear",
  "no longer",
  "rather than",
];

function hasCue(text: string, cue: string): boolean {
  const re = new RegExp(
    `(^|[^a-z'])${cue.replace(/ /g, "\\s+")}(?![a-z])`,
    "g",
  );
  for (const m of text.matchAll(re)) {
    const before = text.slice(0, (m.index ?? 0) + m[1].length);
    if (!/\b(don't|do not|never|not)\s+$/.test(before)) return true;
  }
  return false;
}

/** The request adds to the list rather than replacing it. */
export function addsToList(utterance: string): boolean {
  // URLs out first: a path like `/add/` or `/only/` is not a cue.
  const text = utterance
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/g, " ");
  const adds = ADD_CUES.some((c) =>
    /^(don't|do not)/.test(c) ? text.includes(c) : hasCue(text, c),
  );
  return adds && !REPLACE_CUES.some((c) => hasCue(text, c));
}

/**
 * `args` with each root list in `lists` completed; `changed` names the
 * paths that differ from the model's output.
 */
export function completeLists(
  args: Record<string, unknown>,
  lists: Record<string, CurrentList>,
  utterance: string,
): { args: Record<string, unknown>; changed: string[] } {
  const out = { ...args };
  const changed: string[] = [];
  for (const [path, { mode, values }] of Object.entries(lists)) {
    const got = out[path];
    if (!Array.isArray(got) || values.length === 0) continue;
    const given = [
      ...new Set(got.filter((v): v is string => typeof v === "string")),
    ];
    let next: string[];
    if (mode === "order") {
      const placed = given.filter((v) => values.includes(v));
      next = [...placed, ...values.filter((v) => !placed.includes(v))];
    } else {
      if (!addsToList(utterance)) continue;
      next = [...values, ...given.filter((v) => !values.includes(v))];
    }
    if (JSON.stringify(next) !== JSON.stringify(got)) {
      out[path] = next;
      changed.push(path);
    }
  }
  return { args: out, changed };
}
