/**
 * Seeded states for ref ops: each recipe replays real creation actions,
 * lists labeled candidates per ref path, gives each teacher item a target
 * at a random position among distractors, and checks the item's effect.
 *
 *   npx --no-install tsx training/gen/ref-scenarios.ts <spec.json> <out.json>
 *
 * spec: [{cid, op, items, seed}]. These label conventions are training's;
 * only knowledge-note topics/links have a runtime extractor today.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { PHDocument } from "document-model";
import type { CatalogEntry } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { leafFields } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { buildTrainingCatalog } from "./prompt-format.js";
import {
  BATCHES,
  CATEGORIES,
  CONTEXT_PHRASES,
  PEOPLE,
  SESSIONS,
  THEMES,
  type Theme,
} from "./ref-pools.js";
import {
  IdSource,
  replayers,
  replayFixture,
  type FixtureStep,
} from "./replay.js";

type Rec = Record<string, unknown>;
export interface Cand {
  id: string;
  label: string;
}
/** An item the app lists outside the document (drive docs, sessions). */
export interface CtxItem {
  id: string;
  title: string;
  kind: string;
}
export type Refs = Record<string, string | string[] | null>;
export interface Assignment {
  refs: Refs;
  hint?: string;
}
type Rng = () => number;
type Extract = (state: Rec, ctx: CtxItem[]) => Cand[];

interface Recipe {
  build: (r: Rng, t: Theme) => { fixture: FixtureStep[]; ctx: CtxItem[] };
  paths: Record<string, Extract>;
  assign: (r: Rng, c: Record<string, Cand[]>, s: Rec, k: number) => Assignment[];
  /** Null when the replayed item had the intended effect. */
  check: (before: Rec, after: Rec, input: Rec) => string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: Rng, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sample = <T>(r: Rng, xs: readonly T[], k: number): T[] =>
  shuffle(r, xs).slice(0, k);

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const byId = (xs: Rec[], id: unknown) => xs.find((x) => x.id === id);
const titleOf = (ctx: CtxItem[], id: unknown) =>
  ctx.find((c) => c.id === id)?.title ?? str(id);
const ctxOf = (kind: string): Extract => (_s, ctx) =>
  ctx.filter((c) => c.kind === kind).map((c) => ({ id: c.id, label: c.title }));

/** `k` distinct picks (cycling when k > n), each at a random position. */
function targets(r: Rng, cands: Cand[], k: number): Cand[] {
  const order = shuffle(r, cands);
  return Array.from({ length: k }, (_, i) => order[i % order.length]);
}
const one = (path: string, extra: (c: Cand, i: number) => Assignment = () => ({ refs: {} })) =>
  (r: Rng, c: Record<string, Cand[]>, _s: Rec, k: number): Assignment[] =>
    targets(r, c[path], k).map((t, i) => {
      const a = extra(t, i);
      return { ...a, refs: { [path]: t.id, ...a.refs } };
    });
/** Optional ref: set in about 3 of 4 items, else explicitly not used. */
const optional = (path: string, hint: (c: Cand) => string) =>
  (r: Rng, c: Record<string, Cand[]>, _s: Rec, k: number): Assignment[] =>
    targets(r, c[path], k).map((t, i) =>
      i % 4 === 3
        ? { refs: { [path]: null }, hint: `do not refer to any listed ${path} item` }
        : { refs: { [path]: t.id }, hint: hint(t) },
    );

const okIf = (cond: boolean, why: string) => (cond ? null : why);

/* ------------------------------------------------------------------ */
/* knowledge-note                                                       */
/* ------------------------------------------------------------------ */

const LINK_TYPES = ["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM"];

function noteBase(r: Rng, t: Theme, nTopics: number, nLinks: number, extraNotes = 0) {
  const title = pick(r, t.notes);
  const fixture: FixtureStep[] = [{ op: "knowledge-note:SET_TITLE", args: { title } }];
  const topics = sample(r, t.topics, nTopics);
  topics.forEach((name, i) =>
    fixture.push({ op: "knowledge-note:ADD_TOPIC", args: { name }, newIds: [`topic-${i + 1}`] }),
  );
  const docs = sample(r, t.notes.filter((x) => x !== title), nLinks + extraNotes);
  const ctx: CtxItem[] = docs.map((title, i) => ({ id: `doc-note-${i + 1}`, title, kind: "note" }));
  ctx.slice(0, nLinks).forEach((d, i) =>
    fixture.push({
      op: "knowledge-note:ADD_LINK",
      args: { targetDocumentId: d.id, targetTitle: d.title, linkType: pick(r, LINK_TYPES) },
      newIds: [`link-${i + 1}`],
    }),
  );
  return { fixture, ctx };
}
// Mirrors `noteRefCandidates` (hooks/use-chat-llm.ts): topic name, link title.
const noteTopics: Extract = (s) =>
  recs(s.topics).map((x) => ({ id: str(x.id), label: str(x.name) }));
const noteLinks: Extract = (s) =>
  recs(s.links).map((x) => ({
    id: str(x.id),
    label: str(x.targetTitle) || str(x.targetDocumentId),
  }));
const unlinkedNotes: Extract = (s, ctx) => {
  const linked = new Set(recs(s.links).map((l) => l.targetDocumentId));
  return ctxOf("note")(s, ctx).filter((c) => !linked.has(c.id));
};

/* ------------------------------------------------------------------ */
/* wbs                                                                  */
/* ------------------------------------------------------------------ */

const GOAL_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "COMPLETED"];

function wbsBase(r: Rng, t: Theme, n: number, opts: { notes?: boolean; deps?: boolean } = {}) {
  const goals = sample(r, t.goals, n).map((description, i) => ({ id: `goal-${i + 1}`, description }));
  const fixture: FixtureStep[] = [
    { op: "wbs:SET_OWNER", args: { owner: pick(r, PEOPLE) } },
    ...goals.map((g) => ({ op: "wbs:CREATE_GOAL", args: { description: g.description }, newIds: [g.id] })),
  ];
  for (const g of goals)
    if (r() < 0.6)
      fixture.push({ op: "wbs:SET_GOAL_STATUS", args: { id: g.id, status: pick(r, GOAL_STATUSES) } });
  if (opts.notes) {
    const remarks = sample(r, t.remarks, Math.min(t.remarks.length, n));
    remarks.forEach((note, i) =>
      fixture.push({
        op: "wbs:ADD_NOTE",
        args: { goalId: goals[i % goals.length].id, note, author: pick(r, PEOPLE) },
        newIds: [`gnote-${i + 1}`],
      }),
    );
  }
  if (opts.deps) {
    // Every goal but the last two depends on two later goals.
    for (let i = 0; i + 2 < goals.length; i++)
      fixture.push({
        op: "wbs:ADD_DEPENDENCIES",
        args: { id: goals[i].id, dependencies: [goals[i + 1].id, goals[i + 2].id] },
      });
  }
  return { fixture, ctx: [] as CtxItem[] };
}
const wbsGoals: Extract = (s) =>
  recs(s.goals).map((g) => ({ id: str(g.id), label: str(g.description) }));
const wbsNotes: Extract = (s) =>
  recs(s.goals).flatMap((g) => recs(g.notes).map((n) => ({ id: str(n.id), label: str(n.note) })));
const goalAfter = (after: Rec, id: unknown) => byId(recs(after.goals), id);
const goalField = (field: string) => (_b: Rec, a: Rec, input: Rec) => {
  const g = goalAfter(a, input.id);
  return okIf(!!g && g[field] === input[field], `goal ${field} not set`);
};

/* ------------------------------------------------------------------ */
/* project                                                              */
/* ------------------------------------------------------------------ */

const ROLES = ["designer", "researcher", "volunteer lead", "treasurer", "developer", "editor", "coordinator"];
const DELIVERABLE_STATUSES = ["PLANNED", "IN_PROGRESS", "DELIVERED"];

function projectBase(r: Rng, t: Theme, o: { members?: number; deliverables?: number; wbs?: boolean; knowledge?: number }) {
  const fixture: FixtureStep[] = [];
  const ctx: CtxItem[] = [];
  sample(r, PEOPLE, o.members ?? 0).forEach((name, i) =>
    fixture.push({
      op: "project:ADD_MEMBER",
      args: { name, role: pick(r, ROLES), kind: "HUMAN" },
      newIds: [`member-${i + 1}`],
    }),
  );
  sample(r, t.deliverables, o.deliverables ?? 0).forEach((title, i) => {
    fixture.push({ op: "project:ADD_DELIVERABLE", args: { title }, newIds: [`deliv-${i + 1}`] });
    if (r() < 0.6)
      fixture.push({
        op: "project:SET_DELIVERABLE_STATUS",
        args: { id: `deliv-${i + 1}`, status: pick(r, DELIVERABLE_STATUSES) },
      });
  });
  if (o.wbs) {
    ctx.push({ id: "doc-wbs-1", title: `${t.name} plan`, kind: "wbs" });
    fixture.push({ op: "project:LINK_WBS", args: { wbsRef: "doc-wbs-1" } });
    sample(r, t.goals, 4).forEach((title, i) =>
      ctx.push({ id: `wbs-goal-${i + 1}`, title, kind: "wbs-goal" }),
    );
  }
  if (o.knowledge) {
    sample(r, t.notes, o.knowledge).forEach((title, i) =>
      ctx.push({ id: `doc-know-${i + 1}`, title, kind: "knowledge" }),
    );
  }
  return { fixture, ctx };
}
const team: Extract = (s) => recs(s.team).map((m) => ({ id: str(m.id), label: str(m.name) }));
const deliverables: Extract = (s) =>
  recs(s.deliverables).map((d) => ({ id: str(d.id), label: str(d.title) }));
const linkedKnowledge: Extract = (s, ctx) =>
  (Array.isArray(s.knowledgeRefs) ? s.knowledgeRefs : []).map((id) => ({
    id: str(id),
    label: titleOf(ctx, id),
  }));
const unlinkedKnowledge: Extract = (s, ctx) => {
  const linked = new Set(Array.isArray(s.knowledgeRefs) ? s.knowledgeRefs : []);
  return ctxOf("knowledge")(s, ctx).filter((c) => !linked.has(c.id));
};

/* ------------------------------------------------------------------ */
/* moc, pipeline-queue, research-claim, vault-config                    */
/* ------------------------------------------------------------------ */

function mocBase(r: Rng, t: Theme, nIdeas: number, nTensions: number) {
  const ctx = sample(r, t.notes, nIdeas).map((title, i) => ({ id: `doc-note-${i + 1}`, title, kind: "note" }));
  const phrases = sample(r, CONTEXT_PHRASES, nIdeas);
  const fixture: FixtureStep[] = [
    {
      op: "moc:CREATE_MOC",
      args: { title: `${t.name} map`, description: `Entry point for ${t.name} notes`, orientation: "Start with the core ideas, then the tensions", tier: "TOPIC" },
    },
    ...ctx.map((d, i) => ({
      op: "moc:ADD_CORE_IDEA",
      args: { noteRef: d.id, contextPhrase: phrases[i], sortOrder: i },
      newIds: [`idea-${i + 1}`],
    })),
    ...sample(r, t.tensions, nTensions).map((description, i) => ({
      op: "moc:ADD_TENSION",
      args: { description, involvedRefs: [] },
      newIds: [`mtension-${i + 1}`],
    })),
  ];
  return { fixture, ctx };
}
const coreIdeas: Extract = (s, ctx) =>
  recs(s.coreIdeas).map((c) => ({ id: str(c.id), label: titleOf(ctx, c.noteRef) }));
const mocTensions: Extract = (s) =>
  recs(s.tensions).map((x) => ({ id: str(x.id), label: str(x.description) }));

function queueBase(r: Rng, t: Theme, n: number, o: { block?: number; batches?: boolean } = {}) {
  const batches = sample(r, BATCHES, 2);
  const fixture: FixtureStep[] = sample(r, t.tasks, n).map((target, i) => ({
    op: "pipeline-queue:ADD_TASK",
    args: {
      taskType: target.startsWith("sources/") ? "claim" : "enrichment",
      target,
      ...(o.batches ? { batchId: batches[i % 2] } : {}),
    },
    newIds: [`task-${i + 1}`],
  }));
  for (let i = 0; i < n; i++) {
    if (i < (o.block ?? 0))
      fixture.push({ op: "pipeline-queue:BLOCK_TASK", args: { taskId: `task-${i + 1}`, reason: "waiting on a source file" } });
    else if (r() < 0.4)
      fixture.push({ op: "pipeline-queue:ASSIGN_TASK", args: { taskId: `task-${i + 1}`, assignedTo: pick(r, PEOPLE) } });
  }
  return { fixture, ctx: [] as CtxItem[] };
}
const tasks: Extract = (s) => recs(s.tasks).map((x) => ({ id: str(x.id), label: str(x.target) }));
const batchIds: Extract = (s) =>
  [...new Set(recs(s.tasks).map((x) => str(x.batchId)).filter(Boolean))].map((b) => ({ id: b, label: b }));
const taskAfter = (a: Rec, input: Rec) => byId(recs(a.tasks), input.taskId);
const taskStatus = (status: string) => (_b: Rec, a: Rec, input: Rec) =>
  okIf(taskAfter(a, input)?.status === status, `task not ${status}`);

function claimBase(r: Rng, t: Theme, n: number) {
  const ctx = sample(r, t.claims, n).map((title, i) => ({ id: `doc-claim-${i + 1}`, title, kind: "claim" }));
  const phrases = sample(r, CONTEXT_PHRASES, n);
  const fixture: FixtureStep[] = [
    {
      op: "research-claim:CREATE_CLAIM",
      args: {
        title: pick(r, t.claims.filter((c) => !ctx.some((d) => d.title === c))),
        description: `A working claim from the ${t.name} notes`,
        content: "",
        kind: "research",
        methodology: [],
        sources: [],
        topics: [],
      },
    },
    ...ctx.map((d, i) => ({
      op: "research-claim:ADD_RESEARCH_CONNECTION",
      args: { targetRef: d.id, contextPhrase: phrases[i] },
      newIds: [`conn-${i + 1}`],
    })),
  ];
  return { fixture, ctx };
}

function configBase(r: Rng, n: number) {
  const fixture: FixtureStep[] = sample(r, CATEGORIES, n).map((c, i) => ({
    op: "vault-config:ADD_EXTRACTION_CATEGORY",
    args: { name: c.name, description: c.description, active: r() < 0.6 },
    newIds: [`cat-${i + 1}`],
  }));
  return { fixture, ctx: [] as CtxItem[] };
}

/* ------------------------------------------------------------------ */
/* Recipes (one per ref op)                                             */
/* ------------------------------------------------------------------ */

const removedFrom = (coll: string, key = "id") => (b: Rec, a: Rec, input: Rec) =>
  okIf(
    !!byId(recs(b[coll]), input[key]) && !byId(recs(a[coll]), input[key]),
    `${coll} item not removed`,
  );

export const RECIPES: Record<string, Recipe> = {
  "knowledge-note:SET_PROVENANCE": {
    build: (r, t) => {
      const b = noteBase(r, t, 2, 0);
      return { ...b, ctx: sample(r, SESSIONS, int(r, 3, 5)).map((title, i) => ({ id: `session-${i + 1}`, title, kind: "session" })) };
    },
    paths: { sessionId: ctxOf("session") },
    assign: optional("sessionId", (c) => `the note came out of the session "${c.label}"`),
    check: (_b, a, input) => okIf(isRec(a.provenance) && a.provenance.sessionId === (input.sessionId ?? null), "sessionId not recorded"),
  },
  "knowledge-note:ADD_LINK": {
    build: (r, t) => noteBase(r, t, 1, int(r, 0, 1), int(r, 3, 5)),
    paths: { targetDocumentId: unlinkedNotes },
    assign: one("targetDocumentId"),
    check: (_b, a, input) => okIf(recs(a.links).some((l) => l.targetDocumentId === input.targetDocumentId), "link not added"),
  },
  "knowledge-note:REMOVE_LINK": {
    build: (r, t) => noteBase(r, t, 1, int(r, 3, 5)),
    paths: { id: noteLinks },
    assign: one("id"),
    check: removedFrom("links"),
  },
  "knowledge-note:UPDATE_LINK_TYPE": {
    build: (r, t) => noteBase(r, t, 1, int(r, 3, 5)),
    paths: { id: noteLinks },
    assign: one("id"),
    check: (_b, a, input) => okIf(byId(recs(a.links), input.id)?.linkType === input.linkType, "link type not set"),
  },
  "knowledge-note:ADD_TOPIC": {
    build: (r, t) => {
      const b = noteBase(r, t, int(r, 1, 2), 0);
      const used = new Set(b.fixture.map((f) => f.args.name));
      const docs = t.topics.filter((x) => !used.has(x)).slice(0, int(r, 3, 5));
      return { ...b, ctx: docs.map((title, i) => ({ id: `doc-topic-${i + 1}`, title, kind: "topic" })) };
    },
    paths: { topicDocumentId: ctxOf("topic") },
    assign: optional("topicDocumentId", (c) => `the tag is the existing topic page "${c.label}"`),
    check: (_b, a, input) =>
      okIf(recs(a.topics).some((x) => x.name === input.name && (x.topicDocumentId ?? null) === (input.topicDocumentId ?? null)), "topic not added"),
  },
  "knowledge-note:REMOVE_TOPIC": {
    build: (r, t) => noteBase(r, t, int(r, 3, 6), 0),
    paths: { id: noteTopics },
    assign: one("id"),
    check: removedFrom("topics"),
  },

  "moc:UPDATE_CORE_IDEA": {
    build: (r, t) => mocBase(r, t, int(r, 3, 5), 1),
    paths: { id: coreIdeas },
    assign: one("id"),
    check: (_b, a, input) => {
      const c = byId(recs(a.coreIdeas), input.id);
      if (!c) return "core idea missing";
      if (input.contextPhrase && c.contextPhrase !== input.contextPhrase) return "contextPhrase not set";
      if (typeof input.sortOrder === "number" && c.sortOrder !== input.sortOrder) return "sortOrder not set";
      return null;
    },
  },
  "moc:REMOVE_CORE_IDEA": {
    build: (r, t) => mocBase(r, t, int(r, 3, 5), 1),
    paths: { id: coreIdeas },
    assign: one("id"),
    check: removedFrom("coreIdeas"),
  },
  "moc:REORDER_CORE_IDEAS": {
    build: (r, t) => mocBase(r, t, int(r, 3, 5), 0),
    paths: { ids: coreIdeas },
    assign: (r, c, _s, k) =>
      targets(r, c.ids, k).map((x) => {
        const rest = c.ids.filter((y) => y.id !== x.id);
        const anchor = pick(r, rest);
        const orderFor = (w: string) =>
          w === "top" ? [x, ...rest]
          : w === "bottom" ? [...rest, x]
          : rest.flatMap((y) => (y.id === anchor.id ? [y, x] : [y]));
        const same = (o: Cand[]) => o.every((y, i) => y.id === c.ids[i].id);
        // A move that leaves the order as it is would be a no-op.
        const where = shuffle(r, ["top", "bottom", "after"]).find((w) => !same(orderFor(w))) ?? "top";
        const order = orderFor(where);
        const hint =
          where === "after" ? `move "${x.label}" to just after "${anchor.label}"` : `move "${x.label}" to the ${where}`;
        return { refs: { ids: order.map((y) => y.id) }, hint: `${hint}; the full new order is ${order.map((y) => JSON.stringify(y.label)).join(", ")}` };
      }),
    check: (b, a, input) => {
      const ids = Array.isArray(input.ids) ? input.ids : [];
      const after = recs(a.coreIdeas).map((c) => c.id);
      return okIf(after.length === recs(b.coreIdeas).length && after.every((id, i) => id === ids[i]), "order not applied or ideas dropped");
    },
  },
  "moc:REMOVE_TENSION": {
    build: (r, t) => mocBase(r, t, 2, int(r, 3, 5)),
    paths: { id: mocTensions },
    assign: one("id"),
    check: removedFrom("tensions"),
  },

  "pipeline-queue:ADD_TASK": {
    build: (r, t) => queueBase(r, t, 4, { batches: true }),
    paths: { batchId: batchIds },
    assign: optional("batchId", (c) => `the new task joins the existing batch "${c.label}"`),
    check: (_b, a, input) => okIf(recs(a.tasks).some((x) => x.target === input.target && (x.batchId ?? null) === (input.batchId ?? null)), "task not added"),
  },
  "pipeline-queue:ASSIGN_TASK": {
    build: (r, t) => queueBase(r, t, int(r, 3, 5)),
    paths: { taskId: tasks },
    assign: one("taskId"),
    check: (_b, a, input) => okIf(taskAfter(a, input)?.assignedTo === input.assignedTo, "task not assigned"),
  },
  "pipeline-queue:ADVANCE_PHASE": {
    build: (r, t) => queueBase(r, t, int(r, 3, 5)),
    paths: { taskId: tasks },
    assign: one("taskId", () => ({ refs: {}, hint: "the handoff's phase is the task's current phase" })),
    check: (b, a, input) => {
      const before = byId(recs(b.tasks), input.taskId);
      const h = isRec(input.handoff) ? input.handoff : {};
      if (!before || h.phase !== before.currentPhase) return "handoff phase is not the task's current phase";
      return okIf(recs(taskAfter(a, input)?.handoffs).length === recs(before.handoffs).length + 1, "handoff not recorded");
    },
  },
  "pipeline-queue:COMPLETE_TASK": {
    build: (r, t) => queueBase(r, t, int(r, 3, 5)),
    paths: { taskId: tasks },
    assign: one("taskId"),
    check: taskStatus("DONE"),
  },
  "pipeline-queue:FAIL_TASK": {
    build: (r, t) => queueBase(r, t, int(r, 3, 5)),
    paths: { taskId: tasks },
    assign: one("taskId"),
    check: taskStatus("FAILED"),
  },
  "pipeline-queue:BLOCK_TASK": {
    build: (r, t) => queueBase(r, t, int(r, 3, 5)),
    paths: { taskId: tasks },
    assign: one("taskId"),
    check: taskStatus("BLOCKED"),
  },
  "pipeline-queue:UNBLOCK_TASK": {
    // Two blocked tasks among 4-5; the target is always a blocked one.
    build: (r, t) => queueBase(r, t, int(r, 4, 5), { block: 2 }),
    paths: { taskId: tasks },
    assign: (r, c, s, k) => {
      const blocked = c.taskId.filter((x) => byId(recs(s.tasks), x.id)?.status === "BLOCKED");
      return targets(r, blocked, k).map((x) => ({ refs: { taskId: x.id } }));
    },
    check: (b, a, input) =>
      okIf(byId(recs(b.tasks), input.taskId)?.status === "BLOCKED" && taskAfter(a, input)?.status === "PENDING", "task not unblocked"),
  },

  "project:LINK_WBS": {
    build: (r, t) => {
      const b = projectBase(r, t, { members: 2 });
      const others = sample(r, THEMES.filter((x) => x !== t), int(r, 2, 3));
      const ctx = shuffle(r, [t, ...others]).map((x, i) => ({ id: `doc-wbs-${i + 1}`, title: `${x.name} plan`, kind: "wbs" }));
      return { ...b, ctx };
    },
    paths: { wbsRef: ctxOf("wbs") },
    assign: one("wbsRef"),
    check: (_b, a, input) => okIf(a.wbsRef === input.wbsRef, "wbsRef not set"),
  },
  "project:UPDATE_MEMBER": {
    build: (r, t) => projectBase(r, t, { members: int(r, 3, 5) }),
    paths: { id: team },
    assign: one("id"),
    check: (_b, a, input) => {
      const m = byId(recs(a.team), input.id);
      if (!m) return "member missing";
      for (const k of ["name", "role", "kind"]) if (input[k] && m[k] !== input[k]) return `member ${k} not set`;
      return null;
    },
  },
  "project:REMOVE_MEMBER": {
    build: (r, t) => projectBase(r, t, { members: int(r, 3, 5) }),
    paths: { id: team },
    assign: one("id"),
    check: removedFrom("team"),
  },
  "project:ADD_DELIVERABLE": {
    build: (r, t) => projectBase(r, t, { deliverables: 2, wbs: true }),
    paths: { goalRef: ctxOf("wbs-goal") },
    assign: optional("goalRef", (c) => `the deliverable belongs to the linked plan's goal "${c.label}"`),
    check: (_b, a, input) => okIf(recs(a.deliverables).some((d) => d.title === input.title && (d.goalRef ?? null) === (input.goalRef ?? null)), "deliverable not added"),
  },
  "project:UPDATE_DELIVERABLE": {
    build: (r, t) => projectBase(r, t, { deliverables: int(r, 3, 5), wbs: true }),
    paths: { id: deliverables, goalRef: ctxOf("wbs-goal") },
    assign: (r, c, _s, k) =>
      targets(r, c.id, k).map((x, i) => {
        if (i % 2 === 1) {
          const g = pick(r, c.goalRef);
          return { refs: { id: x.id, goalRef: g.id }, hint: `attach it to the linked plan's goal "${g.label}" (no other change)` };
        }
        return { refs: { id: x.id, goalRef: null }, hint: "change its title, description or url; do not mention plan goals" };
      }),
    check: (_b, a, input) => {
      const d = byId(recs(a.deliverables), input.id);
      if (!d) return "deliverable missing";
      for (const k of ["title", "description", "url", "goalRef"]) if (input[k] && d[k] !== input[k]) return `deliverable ${k} not set`;
      return null;
    },
  },
  "project:SET_DELIVERABLE_STATUS": {
    build: (r, t) => projectBase(r, t, { deliverables: int(r, 3, 5) }),
    paths: { id: deliverables },
    assign: one("id"),
    check: (_b, a, input) => okIf(byId(recs(a.deliverables), input.id)?.status === input.status, "status not set"),
  },
  "project:REMOVE_DELIVERABLE": {
    build: (r, t) => projectBase(r, t, { deliverables: int(r, 3, 5) }),
    paths: { id: deliverables },
    assign: one("id"),
    check: removedFrom("deliverables"),
  },
  "project:ADD_KNOWLEDGE_REF": {
    build: (r, t) => {
      const b = projectBase(r, t, { members: 2, knowledge: int(r, 4, 6) });
      b.fixture.push({ op: "project:ADD_KNOWLEDGE_REF", args: { ref: b.ctx[0].id } });
      return b;
    },
    paths: { ref: unlinkedKnowledge },
    assign: one("ref"),
    check: (_b, a, input) => okIf(Array.isArray(a.knowledgeRefs) && a.knowledgeRefs.includes(input.ref), "ref not linked"),
  },
  "project:REMOVE_KNOWLEDGE_REF": {
    build: (r, t) => {
      const b = projectBase(r, t, { members: 1, knowledge: int(r, 3, 5) });
      for (const d of b.ctx) b.fixture.push({ op: "project:ADD_KNOWLEDGE_REF", args: { ref: d.id } });
      return b;
    },
    paths: { ref: linkedKnowledge },
    assign: one("ref"),
    check: (b, a, input) =>
      okIf(Array.isArray(b.knowledgeRefs) && b.knowledgeRefs.includes(input.ref) && Array.isArray(a.knowledgeRefs) && !a.knowledgeRefs.includes(input.ref), "ref not removed"),
  },

  "research-claim:REMOVE_RESEARCH_CONNECTION": {
    build: (r, t) => claimBase(r, t, int(r, 3, 5)),
    paths: { id: (s, ctx) => recs(s.connections).map((c) => ({ id: str(c.id), label: titleOf(ctx, c.targetRef) })) },
    assign: one("id"),
    check: removedFrom("connections"),
  },
  "vault-config:TOGGLE_EXTRACTION_CATEGORY": {
    build: (r) => configBase(r, int(r, 3, 6)),
    paths: { id: (s) => recs(s.extractionCategories).map((c) => ({ id: str(c.id), label: str(c.name) })) },
    assign: (r, c, s, k) =>
      targets(r, c.id, k).map((x) => {
        const on = byId(recs(s.extractionCategories), x.id)?.active === true;
        return { refs: { id: x.id }, hint: on ? "the message turns it off (active false)" : "the message turns it on (active true)" };
      }),
    check: (b, a, input) => {
      const was = byId(recs(b.extractionCategories), input.id)?.active;
      const now = byId(recs(a.extractionCategories), input.id)?.active;
      return okIf(now === input.active && was !== now, "category not toggled");
    },
  },

  "wbs:CREATE_GOAL": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { parentId: wbsGoals, insertBefore: wbsGoals },
    assign: (r, c, _s, k) =>
      targets(r, c.parentId, k).map((x, i) =>
        i % 4 === 2
          ? { refs: { parentId: null, insertBefore: x.id }, hint: `the new goal goes right before "${x.label}" (same level)` }
          : i % 4 === 3
            ? { refs: { parentId: null, insertBefore: null }, hint: "a new top-level goal; do not mention listed goals" }
            : { refs: { parentId: x.id, insertBefore: null }, hint: `the new goal is a sub-goal of "${x.label}"` },
      ),
    check: (_b, a, input) => {
      const g = recs(a.goals).find((x) => x.description === input.description);
      return okIf(!!g && (g.parentId ?? null) === (input.parentId ?? null), "goal not created under the parent");
    },
  },
  "wbs:UPDATE_GOAL_DESCRIPTION": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals },
    assign: one("id"),
    check: goalField("description"),
  },
  "wbs:DELETE_GOAL": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals },
    assign: one("id"),
    check: removedFrom("goals"),
  },
  "wbs:REORDER": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals, parentId: wbsGoals, insertBefore: wbsGoals },
    assign: (r, c, _s, k) =>
      targets(r, c.id, k).map((x, i) => {
        const y = pick(r, c.id.filter((g) => g.id !== x.id));
        return i % 2 === 0
          ? { refs: { id: x.id, parentId: y.id, insertBefore: null }, hint: `move "${x.label}" under "${y.label}"` }
          : { refs: { id: x.id, parentId: null, insertBefore: y.id }, hint: `move "${x.label}" to just before "${y.label}"` };
      }),
    check: (_b, a, input) => {
      const goals = recs(a.goals);
      const g = byId(goals, input.id);
      if (!g) return "goal missing";
      if (input.parentId) return okIf(g.parentId === input.parentId, "parent not set");
      const i = goals.indexOf(g);
      return okIf(goals[i + 1]?.id === input.insertBefore, "not placed before the anchor");
    },
  },
  "wbs:SET_GOAL_STATUS": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals },
    assign: one("id"),
    check: goalField("status"),
  },
  "wbs:ASSIGN_GOAL": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals },
    assign: one("id"),
    check: goalField("assignee"),
  },
  "wbs:SET_OUTCOME": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals },
    assign: one("id"),
    check: goalField("outcome"),
  },
  "wbs:ADD_DEPENDENCIES": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { id: wbsGoals, dependencies: wbsGoals },
    assign: (r, c, _s, k) =>
      targets(r, c.id, k).map((x, i) => {
        const deps = sample(r, c.id.filter((g) => g.id !== x.id), i % 3 === 2 ? 2 : 1);
        return { refs: { id: x.id, dependencies: deps.map((d) => d.id) }, hint: `"${x.label}" now waits on ${deps.map((d) => `"${d.label}"`).join(" and ")}` };
      }),
    check: (_b, a, input) => {
      const deps = goalAfter(a, input.id)?.dependencies;
      const want = Array.isArray(input.dependencies) ? input.dependencies : [];
      return okIf(Array.isArray(deps) && want.every((d) => deps.includes(d)), "dependencies not added");
    },
  },
  "wbs:REMOVE_DEPENDENCIES": {
    build: (r, t) => wbsBase(r, t, int(r, 4, 5), { deps: true }),
    paths: { id: wbsGoals, dependencies: wbsGoals },
    assign: (r, c, s, k) => {
      const withDeps = c.id.filter((g) => recs(s.goals).some((x) => x.id === g.id && Array.isArray(x.dependencies) && x.dependencies.length > 0));
      return targets(r, withDeps, k).map((x) => {
        const deps = (byId(recs(s.goals), x.id)?.dependencies as string[]) ?? [];
        const d = pick(r, deps);
        const label = c.dependencies.find((y) => y.id === d)?.label ?? d;
        return { refs: { id: x.id, dependencies: [d] }, hint: `"${x.label}" no longer waits on "${label}"` };
      });
    },
    check: (b, a, input) => {
      const want = Array.isArray(input.dependencies) ? input.dependencies : [];
      const before = goalAfter(b, input.id)?.dependencies;
      const after = goalAfter(a, input.id)?.dependencies;
      return okIf(Array.isArray(before) && Array.isArray(after) && want.every((d) => before.includes(d) && !after.includes(d)), "dependency not removed");
    },
  },
  "wbs:ADD_NOTE": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 5)),
    paths: { goalId: wbsGoals },
    assign: one("goalId"),
    check: (_b, a, input) => okIf(recs(goalAfter(a, input.goalId)?.notes).some((n) => n.note === input.note), "note not added"),
  },
  "wbs:REMOVE_NOTE": {
    build: (r, t) => wbsBase(r, t, int(r, 3, 4), { notes: true }),
    paths: { goalId: wbsGoals, noteId: wbsNotes },
    assign: (r, c, s, k) =>
      targets(r, c.noteId, k).map((n) => {
        const g = recs(s.goals).find((x) => recs(x.notes).some((y) => y.id === n.id));
        const gl = c.goalId.find((x) => x.id === g?.id)?.label ?? "";
        return { refs: { goalId: str(g?.id), noteId: n.id }, hint: `remove the note "${n.label}" on the goal "${gl}"` };
      }),
    check: (b, a, input) =>
      okIf(
        recs(goalAfter(b, input.goalId)?.notes).some((n) => n.id === input.noteId) &&
          !recs(goalAfter(a, input.goalId)?.notes).some((n) => n.id === input.noteId),
        "note not removed",
      ),
  },
  "wbs:SET_PROJECT_REF": {
    build: (r, t) => {
      const b = wbsBase(r, t, 3);
      const ctx = shuffle(r, [t, ...sample(r, THEMES.filter((x) => x !== t), int(r, 2, 3))]).map((x, i) => ({
        id: `doc-project-${i + 1}`,
        title: `${x.name}`,
        kind: "project",
      }));
      return { ...b, ctx };
    },
    paths: { projectRef: ctxOf("project") },
    assign: one("projectRef"),
    check: (_b, a, input) => okIf(a.projectRef === input.projectRef, "projectRef not set"),
  },
};

/* ------------------------------------------------------------------ */
/* State view for the teacher                                           */
/* ------------------------------------------------------------------ */

const q = JSON.stringify;
const CTX_HEADINGS: Record<string, string> = {
  note: "Other notes in the drive",
  topic: "Topic pages in the drive",
  wbs: "Work-breakdown documents in the drive",
  project: "Project documents in the drive",
  knowledge: "Knowledge documents in the drive",
  claim: "Claims in the drive",
  session: "Recent capture sessions",
  "wbs-goal": "Goals in the linked work-breakdown plan",
};

/** A readable listing of the seeded state and the app-listed items. */
export function describeState(docType: string, s: Rec, ctx: CtxItem[]): string {
  const out: string[] = [];
  const list = (head: string, lines: string[]) => {
    if (lines.length) out.push(`${head}:`, ...lines.map((l) => `- ${l}`));
  };
  if (docType === "bai/knowledge-note") {
    if (s.title) out.push(`Title: ${q(s.title)}`);
    list("Topics", recs(s.topics).map((x) => q(x.name)));
    list("Links", recs(s.links).map((x) => `${q(x.targetTitle)} (${str(x.linkType)})`));
  } else if (docType === "bai/wbs") {
    const goals = recs(s.goals);
    const desc = (id: unknown) => q(str(byId(goals, id)?.description));
    list("Goals", goals.map((g) => {
      const bits = [str(g.status)];
      if (g.parentId) bits.push(`under ${desc(g.parentId)}`);
      if (g.assignee) bits.push(`assignee ${str(g.assignee)}`);
      const deps = Array.isArray(g.dependencies) ? g.dependencies : [];
      if (deps.length) bits.push(`waits on ${deps.map(desc).join(", ")}`);
      const notes = recs(g.notes).map((n) => q(n.note));
      if (notes.length) bits.push(`notes: ${notes.join("; ")}`);
      return `${q(g.description)} [${bits.join("; ")}]`;
    }));
  } else if (docType === "bai/project") {
    list("Team", recs(s.team).map((m) => `${q(m.name)} (${str(m.role) || "no role"})`));
    list("Deliverables", recs(s.deliverables).map((d) => `${q(d.title)} [${str(d.status)}]`));
    const refs = Array.isArray(s.knowledgeRefs) ? s.knowledgeRefs : [];
    list("Linked knowledge", refs.map((id) => q(titleOf(ctx, id))));
    if (s.wbsRef) out.push(`Linked plan: ${q(titleOf(ctx, s.wbsRef))}`);
  } else if (docType === "bai/moc") {
    if (s.title) out.push(`Title: ${q(s.title)}`);
    list("Core ideas (in order)", recs(s.coreIdeas).map((c) => `${q(titleOf(ctx, c.noteRef))} - ${str(c.contextPhrase)}`));
    list("Tensions", recs(s.tensions).map((x) => q(x.description)));
  } else if (docType === "bai/pipeline-queue") {
    list("Tasks", recs(s.tasks).map((x) => {
      const bits = [str(x.taskType), str(x.status), `phase ${str(x.currentPhase) || "none"}`];
      if (x.assignedTo) bits.push(`assigned to ${str(x.assignedTo)}`);
      if (x.batchId) bits.push(`batch ${str(x.batchId)}`);
      return `${q(x.target)} [${bits.join("; ")}]`;
    }));
  } else if (docType === "bai/research-claim") {
    if (s.title) out.push(`Title: ${q(s.title)}`);
    list("Connections", recs(s.connections).map((c) => `${q(titleOf(ctx, c.targetRef))} - ${str(c.contextPhrase)}`));
  } else if (docType === "bai/vault-config") {
    list("Extraction categories", recs(s.extractionCategories).map((c) => `${q(c.name)} (${c.active ? "on" : "off"}): ${str(c.description)}`));
  }
  for (const kind of [...new Set(ctx.map((c) => c.kind))]) {
    // Items that only name things already shown above are not listed again.
    const linked = new Set(recs(s.links).map((l) => l.targetDocumentId));
    const shown = ctx.filter((c) => c.kind === kind && !linked.has(c.id));
    const labelOnly =
      (docType === "bai/moc" && kind === "note") ||
      (docType === "bai/research-claim" && kind === "claim") ||
      (kind === "wbs" && !!s.wbsRef);
    if (!labelOnly)
      list(CTX_HEADINGS[kind] ?? kind, shown.map((c) => q(c.title)));
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Scenario building and row checks                                     */
/* ------------------------------------------------------------------ */

export function refPaths(entry: CatalogEntry): string[] {
  return leafFields(entry.fields)
    .filter((f) => f.fieldClass === "ref-id")
    .map((f) => f.path.join("."));
}

export function candidatesFor(op: string, state: Rec, ctx: CtxItem[]): Record<string, Cand[]> {
  const recipe = RECIPES[op];
  return Object.fromEntries(Object.entries(recipe.paths).map(([p, f]) => [p, f(state, ctx)]));
}

export interface Scenario {
  cid: string;
  op: string;
  docType: string;
  theme: string;
  fixture: FixtureStep[];
  refContext: CtxItem[];
  refCandidates: Record<string, Cand[]>;
  state: string;
  items: (Assignment & { labels: Record<string, string | string[] | null>; position: Record<string, [number, number]> })[];
}

function stateOf(doc: PHDocument): Rec {
  const state: unknown = doc.state;
  const global = isRec(state) ? state.global : undefined;
  return isRec(global) ? global : {};
}

function main(): void {
  const [specFile, outFile] = process.argv.slice(2);
  const catalog = new Map(buildTrainingCatalog().map((e) => [e.key, e]));
  if (specFile === "--list") {
    const ops = [...catalog.values()].filter((e) => e.scope === "global" && refPaths(e).length);
    const refOps = Object.fromEntries(ops.map((e) => [e.key, refPaths(e)]));
    console.log(JSON.stringify({ refOps, people: PEOPLE }));
    return;
  }
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as { cid: string; op: string; items: number; seed: number }[];
  const reps = replayers();
  const missing = [...catalog.values()].filter((e) => e.scope === "global" && refPaths(e).length && !RECIPES[e.key]).map((e) => e.key);
  if (missing.length) throw new Error(`ref ops without a recipe: ${missing.join(", ")}`);
  const out: Scenario[] = spec.map(({ cid, op, items, seed }) => {
    const entry = catalog.get(op);
    const recipe = RECIPES[op];
    if (!entry || !recipe) throw new Error(`${cid}: no recipe for ${op}`);
    const unknownPath = Object.keys(recipe.paths).filter((p) => !refPaths(entry).includes(p));
    if (unknownPath.length) throw new Error(`${op}: recipe paths ${unknownPath.join(",")} are not ref fields`);
    const r = mulberry32(seed);
    const theme = pick(r, THEMES);
    const built = recipe.build(r, theme);
    const rep = replayFixture(catalog, reps, entry.docType, built.fixture, new IdSource());
    if (rep.error) throw new Error(`${cid}: fixture failed: ${rep.error}`);
    const state = stateOf(rep.doc);
    const cands = candidatesFor(op, state, built.ctx);
    for (const [p, cs] of Object.entries(cands))
      if (cs.length < 2 || new Set(cs.map((c) => c.label)).size !== cs.length)
        throw new Error(`${cid}: ${p} needs 2+ distinct labels, got ${JSON.stringify(cs)}`);
    const assigned = recipe.assign(r, cands, state, items).map((a) => {
      const labels: Record<string, string | string[] | null> = {};
      const position: Record<string, [number, number]> = {};
      for (const [p, v] of Object.entries(a.refs)) {
        const lab = (id: string) => cands[p].find((c) => c.id === id)?.label ?? id;
        labels[p] = v === null ? null : Array.isArray(v) ? v.map(lab) : lab(v);
        if (typeof v === "string") position[p] = [cands[p].findIndex((c) => c.id === v) + 1, cands[p].length];
      }
      return { ...a, labels, position };
    });
    return {
      cid,
      op,
      docType: entry.docType,
      theme: theme.name,
      fixture: built.fixture,
      refContext: built.ctx,
      refCandidates: cands,
      state: describeState(entry.docType, state, built.ctx),
      items: assigned,
    };
  });
  writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ scenarios: out.length, items: out.reduce((n, s) => n + s.items.length, 0) }));
}

if (process.argv[1]?.endsWith("ref-scenarios.ts")) main();

export { stateOf };
