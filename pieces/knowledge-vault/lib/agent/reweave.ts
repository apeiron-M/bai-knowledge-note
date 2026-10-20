import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage } from "../common/errors.js";
import { gatherCandidates, proposeLinksStage, writeLinksStage, type NoteSummary } from "./connect.js";
import type { LlmClient } from "./llm.js";
import { catchUp, findQueue } from "./pipeline.js";
import { mapLimit } from "./staged.js";
import { planStage, readMocs, writePlacementsStage } from "./synthesize.js";

/**
 * Reweave: a second pass for notes the pipeline left unwoven, against the
 * vault as it is now. The pipeline runs each source once, so a note
 * extracted before its neighbours existed (the first section of a long
 * report, connected while the vault held nothing like it) or one left by a
 * run cut off between its steps stays alone for good. Here a note with fewer
 * than 2 links gets the Connect treatment again, a note no MoC holds gets
 * placed, and a pipeline task the notes' source left open is caught up from
 * what the vault now holds.
 */

/** Edge types that connect a note to other notes: the knowledge links, not provenance or MoC structure. */
export const KNOWLEDGE_LINKS = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"]);

export type ReweaveNote = NoteSummary & { links: number; placed: boolean; sourceId: string | null };
type Edge = { direction?: string; documentId?: string; linkType?: string };
type NoteDoc = { name?: string; documentType?: string; state?: { global?: { title?: string; description?: string; status?: string } }; edges?: Edge[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Note ids as a trigger hands them over: a list, or text with the ids separated by commas or spaces (JSON arrays too). */
export function parseNoteIds(value: unknown): string[] {
  let list: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("[")) {
      try {
        list = JSON.parse(text);
      } catch {
        list = text;
      }
    }
    if (typeof list === "string") list = list.split(/[\s,]+/);
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))];
}

/** Each note with what it lacks: its knowledge links, whether a MoC holds it, and the source it came from. */
export async function readReweaveNotes(client: KnowledgeVaultClient, drive: string, ids: string[]): Promise<{ notes: ReweaveNote[]; skipped: { id: string; why: string }[] }> {
  const read = await mapLimit(ids, 6, (id) =>
    client.request<NoteDoc>({ path: `notes/${encodeURIComponent(id)}`, query: { drive } }).then(
      (doc) => ({ id, doc, error: null as string | null }),
      (error: unknown) => ({ id, doc: null, error: errorMessage(error) }),
    ),
  );
  const notes: ReweaveNote[] = [];
  const skipped: { id: string; why: string }[] = [];
  for (const { id, doc, error } of read) {
    if (!doc) {
      skipped.push({ id, why: `could not be read: ${error}` });
      continue;
    }
    const g = doc.state?.global ?? {};
    if (doc.documentType && doc.documentType !== "bai/knowledge-note") skipped.push({ id, why: `is a ${doc.documentType}, not a note` });
    else if (g.status === "ARCHIVED") skipped.push({ id, why: "is archived" });
    else {
      const edges = doc.edges ?? [];
      notes.push({
        id,
        title: g.title ?? doc.name ?? id,
        description: g.description ?? "",
        status: g.status ?? null,
        links: edges.filter((e) => KNOWLEDGE_LINKS.has(e.linkType ?? "")).length,
        placed: edges.some((e) => e.direction === "in" && e.linkType === "CORE_IDEA"),
        sourceId: edges.find((e) => e.direction === "out" && e.linkType === "DERIVED_FROM")?.documentId ?? null,
      });
    }
  }
  return { notes, skipped };
}

/** The sources among these that still have an open claim task in the queue. */
async function sourcesWithOpenTasks(client: KnowledgeVaultClient, drive: string, sourceIds: string[]): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  const queueId = await findQueue(client, drive);
  if (!queueId) return [];
  const doc = await client.request<{ state?: { global?: { tasks?: { status: string; documentRef?: string | null }[] } } }>({ path: `notes/${encodeURIComponent(queueId)}`, query: { drive } });
  const wanted = new Set(sourceIds);
  const open = (doc.state?.global?.tasks ?? []).filter((t) => (t.status === "PENDING" || t.status === "IN_PROGRESS") && !!t.documentRef && wanted.has(t.documentRef));
  return [...new Set(open.map((t) => t.documentRef as string))];
}

type Stage = <T extends { summary: string }>(name: string, work: () => Promise<T> | T) => Promise<T>;

/**
 * The vault proves a phase from its graph index, which takes the links and placements just written a
 * moment later; a catch-up that finds them missing is asked again, a few times, before it is left.
 */
export const CATCH_UP_TRIES = 4;
export const CATCH_UP_PAUSE_MS = 3000;
async function catchUpWhenIndexed(client: KnowledgeVaultClient, drive: string, sourceId: string, pause: (ms: number) => Promise<void>): Promise<string> {
  let out = await catchUp(client, { drive, sourceId, by: "reweave-notes" });
  for (let i = 1; i < CATCH_UP_TRIES && out.advanced.length === 0 && /not connected yet|not in a MoC yet/.test(out.summary); i++) {
    await pause(CATCH_UP_PAUSE_MS);
    out = await catchUp(client, { drive, sourceId, by: "reweave-notes" });
  }
  return out.summary;
}

/**
 * The reweave job, stage by stage (the action wraps it with the timed stage runner). Links come from one
 * model call per three notes, judged on the notes' semantic neighbours today; placements from one call for
 * all of them, which may open a new TOPIC MoC when three or more share a theme no MoC covers. Dry run
 * proposes and writes nothing.
 */
export async function reweave(
  client: KnowledgeVaultClient,
  llm: LlmClient,
  model: string,
  args: { drive: string; noteIds: string[]; write: boolean; pause?: (ms: number) => Promise<void> },
  stage: Stage,
  fetchImpl?: typeof fetch,
) {
  const { drive, write } = args;
  const pause = args.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const read = await stage("read", async () => {
    const r = await readReweaveNotes(client, drive, args.noteIds);
    const thin = r.notes.filter((n) => n.links < 2).length;
    const loose = r.notes.filter((n) => !n.placed).length;
    return {
      ...r,
      summary: `${plural(r.notes.length, "note")} to reweave: ${thin} with fewer than 2 links, ${loose} in no MoC${r.skipped.length ? `; ${r.skipped.length} left out (${r.skipped.map((s) => `${s.id} ${s.why}`).join("; ")})` : ""}.`,
    };
  });
  const toConnect = read.notes.filter((n) => n.links < 2);
  const titles = new Map(read.notes.map((n) => [n.id, n.title] as const));
  let cost = 0;

  // Connect: each note's neighbours on their own, so the notes in this run are candidates for each other
  // only when they are semantically near, not because one run picked them up together.
  let links: { from: string; to: string; type: string; reason: string; confidence: string; from_title: string; to_title: string }[] = [];
  let dropped: { link: string; why: string }[] = [];
  let refused: { link: string; error: string }[] = [];
  let wroteLinks = 0;
  if (toConnect.length) {
    const candidates = await stage("candidates", async () => {
      const all: Awaited<ReturnType<typeof gatherCandidates>> = {};
      for (const note of toConnect) Object.assign(all, await gatherCandidates(client, drive, [note]));
      for (const c of Object.values(all).flat()) titles.set(c.id, c.title);
      const total = Object.values(all).reduce((n, list) => n + list.length, 0);
      return { candidates: all, summary: `${plural(total, "candidate")} from the vault's semantic neighbours.` };
    });
    const proposed = await stage("propose links", () => proposeLinksStage(llm, model, toConnect, candidates.candidates, fetchImpl));
    cost += proposed.cost_usd;
    links = proposed.links.map((l) => ({ ...l, from_title: titles.get(l.from) ?? l.from, to_title: titles.get(l.to) ?? l.to }));
    dropped = proposed.dropped;
    if (write) {
      const written = await stage("write links", () => writeLinksStage(client, proposed.links));
      wroteLinks = written.written.length;
      refused = written.failed;
    }
  }

  // Place: what a MoC took meanwhile (another run, a person) is left alone.
  let placements: { note: string; moc: string; note_id: string; moc_id: string }[] = [];
  let newMocs: { title: string; parent_title: string }[] = [];
  let unplaced: string[] = [];
  let placeProblems: string[] = [];
  let placedNotes = 0;
  if (read.notes.some((n) => !n.placed)) {
    const tree = await stage("read MoCs", async () => {
      const t = await readMocs(client, drive);
      return { ...t, summary: `The vault has ${plural(t.mocs.length, "MoC")}.` };
    });
    const held = new Set([...tree.coreIdeas].map((k) => k.slice(k.indexOf(">") + 1)));
    const toPlace = read.notes.filter((n) => !n.placed && !held.has(n.id));
    if (toPlace.length) {
      const plan = await stage("plan placements", () => planStage(llm, model, toPlace, tree.mocs, fetchImpl));
      cost += plan.cost_usd;
      const mocTitle = new Map(tree.mocs.map((m) => [m.id, m.title] as const));
      placements = plan.placements.map((p) => ({
        note: titles.get(p.note) ?? p.note,
        moc: p.moc.startsWith("new:") ? `new: ${plan.new_mocs.find((m) => m.key === p.moc)?.title ?? p.moc}` : (mocTitle.get(p.moc) ?? p.moc),
        note_id: p.note,
        moc_id: p.moc,
      }));
      newMocs = plan.new_mocs.map((m) => ({ title: m.title, parent_title: mocTitle.get(m.parent) ?? m.parent }));
      unplaced = plan.unplaced.map((id) => titles.get(id) ?? id);
      placeProblems = plan.problems;
      if (write) {
        const written = await stage("write placements", () => writePlacementsStage(client, { drive, placements: plan.placements, newMocs: plan.new_mocs, coreIdeas: tree.coreIdeas }));
        placedNotes = written.linked;
        placeProblems = [...placeProblems, ...written.problems];
      }
    }
  }

  // A run cut off between its steps left its task open: catch it up from what the vault now holds, so the
  // pipeline finishes it (it then only has Verify left) instead of redoing the work.
  const caughtUp: string[] = [];
  if (write) {
    const sources = [...new Set(read.notes.map((n) => n.sourceId).filter((s): s is string => !!s))];
    const open = await sourcesWithOpenTasks(client, drive, sources).catch(() => []);
    if (open.length) {
      await stage("pipeline", async () => {
        for (const sourceId of open) caughtUp.push(await catchUpWhenIndexed(client, drive, sourceId, pause));
        return { summary: caughtUp.join(" ") };
      });
    }
  }

  const did: string[] = [];
  if (toConnect.length) did.push(write ? `${plural(wroteLinks, "link")} written${refused.length ? ` (${refused.length} refused by the vault)` : ""}` : `${plural(links.length, "link")} proposed`);
  if (placements.length) {
    const where = [...new Set(placements.map((p) => `"${p.moc}"`))].join(", ");
    did.push(write ? `${plural(placedNotes, "note")} placed in ${where}` : `${plural(placements.length, "note")} would go to ${where}`);
  }
  if (unplaced.length) did.push(`${plural(unplaced.length, "note")} still in no MoC (none fits yet; the note is tried again once the vault has grown)`);
  const summary = read.notes.length === 0
    ? `Nothing to reweave: ${read.skipped.map((s) => `${s.id} ${s.why}`).join("; ") || "no notes given"}.`
    : `${write ? "" : "Dry run: "}Reweaved ${plural(read.notes.length, "note")}: ${did.join("; ") || "nothing was missing"}.${caughtUp.length ? ` ${caughtUp.join(" ")}` : ""}`;
  return {
    summary,
    dry_run: !write,
    model,
    links,
    dropped,
    refused,
    placements,
    new_mocs: newMocs,
    unplaced,
    problems: placeProblems,
    skipped: read.skipped,
    pipeline: caughtUp,
    cost_usd: Math.round(cost * 10_000) / 10_000,
  };
}
