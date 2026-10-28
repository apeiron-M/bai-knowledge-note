/**
 * A chat manifest as plain data, for deep equality: every function table
 * (ref extractors, state choices, current lists, the cross-document hook)
 * is replaced by its outputs on probe states, and the catalog's zod schemas
 * and action creators by their JSON Schema and name.
 * `chat-manifest-equality.test.ts` compares the generated manifest with this.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  CandidateDoc,
  CatalogEntry,
  ChatDocument,
  ChatManifest,
  RefContextItem,
} from "nl-runtime";
import { z } from "zod";

type Rec = Record<string, unknown>;

export interface ProbeState {
  name: string;
  model: string | null;
  state: Rec;
  ctx: RefContextItem[];
}

/** One state with every list the extractors read, and context items of every kind. */
const RICH_STATE: Rec = {
  links: [
    { id: "l1", targetDocumentId: "n1", targetTitle: "Note one" },
    { id: "l2", targetDocumentId: "n9", targetTitle: "" },
    { id: "l3", targetDocumentId: "", targetTitle: "" },
  ],
  topics: [{ id: "t1", name: "Bread" }, { id: "t2" }],
  goals: [
    { id: "g1", description: "Ship", notes: [{ id: "gn1", note: "first" }] },
    { id: "g2", description: "Test", notes: [] },
    { id: "g3", notes: [{ id: "gn2", note: "second" }] },
  ],
  team: [{ id: "m1", name: "Ana" }, { id: "m2" }],
  deliverables: [
    { id: "d1", title: "Spec" },
    { id: "d2", title: "" },
  ],
  knowledgeRefs: ["k1", "k9"],
  coreIdeas: [
    { id: "c1", noteRef: "n1" },
    { id: "c2", noteRef: "n404" },
  ],
  tensions: [{ id: "x1", description: "Speed vs quality" }],
  tasks: [
    { id: "tk1", target: "Note A", batchId: "b1" },
    { id: "tk2", target: "Note B", batchId: "b1" },
    { id: "tk3", target: "", batchId: "" },
    { id: "tk4", target: "Note C", batchId: "b2" },
  ],
  connections: [
    { id: "rc1", targetRef: "n1" },
    { id: "rc2", targetRef: "zz" },
  ],
  extractionCategories: [{ id: "e1", name: "claims" }],
  openQuestions: ["Why?", "How?"],
  childRefs: ["moc1", "moc404"],
  references: ["https://a.example", "https://b.example"],
  wbsRef: "w1",
};

const RICH_CTX: RefContextItem[] = [
  { id: "n1", title: "Note one", kind: "note" },
  { id: "n2", title: "Note two", kind: "note" },
  { id: "n9", title: "Nine", kind: "note" },
  { id: "k1", title: "Knowledge one", kind: "knowledge" },
  { id: "k2", title: "Knowledge two", kind: "knowledge" },
  { id: "tp1", title: "Topic", kind: "topic" },
  { id: "s1", title: "Session", kind: "session" },
  { id: "w1", title: "Plan", kind: "wbs" },
  { id: "g1", title: "Ship", kind: "wbs-goal" },
  { id: "p1", title: "Project", kind: "project" },
  { id: "moc1", title: "Bread MOC", kind: "moc" },
];

/** The rich state, an empty one, and every chat-c parity item's state and context. */
export function probeStates(): ProbeState[] {
  const items = readFileSync(
    new URL("../fixtures/chat-c/items.jsonl", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Rec);
  return [
    { name: "rich", model: null, state: RICH_STATE, ctx: RICH_CTX },
    { name: "empty", model: null, state: {}, ctx: [] },
    ...items.map((i) => ({
      name: String(i.id),
      model: String(i.model),
      state: (i.state ?? {}) as Rec,
      ctx: (i.ctx ?? []) as RefContextItem[],
    })),
  ];
}

/** The states an op is probed on: the synthetic two and its own model's items. */
const statesFor = (opKey: string, states: readonly ProbeState[]) =>
  states.filter((s) => s.model === null || s.model === opKey.split(":")[0]);

type FnTable<F> = Readonly<Record<string, Readonly<Record<string, F>>>>;

function probeTable<F, O>(
  table: FnTable<F>,
  states: readonly ProbeState[],
  run: (f: F, s: ProbeState) => O,
): Record<string, Record<string, Record<string, O>>> {
  return Object.fromEntries(
    Object.entries(table).map(([op, paths]) => [
      op,
      Object.fromEntries(
        Object.entries(paths).map(([p, f]) => [
          p,
          Object.fromEntries(
            statesFor(op, states).map((s) => [s.name, run(f, s)]),
          ),
        ]),
      ),
    ]),
  );
}

/** The cross-document hook on a linked plan, a stale link, another type and no link. */
function probeCrossDocument(m: ChatManifest): unknown {
  const hook = m.crossDocument;
  if (!hook) return null;
  const bounded = (kind: string, docs: CandidateDoc[]): RefContextItem[] =>
    docs.map((d) => ({
      id: d.id,
      title: d.title,
      kind: `${kind}|${d.docType}`,
    }));
  const plan: ChatDocument = {
    id: "w1",
    docType: "bai/wbs",
    title: "Plan",
    state: RICH_STATE,
  };
  const project = (wbsRef: string): ChatDocument => ({
    id: "p1",
    docType: "bai/project",
    title: "Project",
    state: { wbsRef },
  });
  return {
    linked: hook(project("w1"), { linked: plan }, bounded),
    stale: hook(project("w2"), { linked: plan }, bounded),
    otherType: hook(
      { ...project("w1"), docType: "bai/moc" },
      { linked: plan },
      bounded,
    ),
    noLink: hook(project("w1"), {}, bounded),
  };
}

/** A catalog entry as data: zod as its input JSON Schema, the creator by name. */
export function plainEntry(e: CatalogEntry): Rec {
  const { zod, creator, ...rest } = e;
  return {
    ...rest,
    zod: z.toJSONSchema(zod, { io: "input" }),
    creator: creator.name,
  };
}

/** The manifest as plain data; `catalog: false` leaves the catalog out. */
export function probeManifest(
  m: ChatManifest,
  opts: { catalog?: boolean; states?: readonly ProbeState[] } = {},
): Rec {
  const states = opts.states ?? probeStates();
  return {
    schemaVersion: m.schemaVersion,
    ...(opts.catalog === false ? {} : { catalog: m.catalog.map(plainEntry) }),
    fieldOverrides: m.fieldOverrides,
    refExtractors: probeTable(m.refExtractors, states, (f, s) =>
      f(s.state, s.ctx),
    ),
    stateChoices: probeTable(m.stateChoices, states, (f, s) =>
      f(s.state, s.ctx),
    ),
    currentLists: probeTable(m.currentLists, states, (c, s) => ({
      mode: c.mode,
      values: c.from(s.state),
    })),
    contextKinds: m.contextKinds,
    crossDocument: probeCrossDocument(m),
    typeLabels: m.typeLabels,
    typeNouns: m.typeNouns ?? null,
    createTypes:
      m.createTypes?.map(([re, intent]) => [String(re), intent]) ?? null,
    opDescriptions: m.opDescriptions,
    vocabularies: m.vocabularies,
    executors: m.executors ?? null,
  };
}

/** JSON with object keys sorted (arrays keep their order). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Rec).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : x,
  );
}

/** sha256 of each probed section's canonical JSON. */
export function probeDigest(m: ChatManifest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(probeManifest(m)).map(([k, v]) => [
      k,
      createHash("sha256").update(canonicalJson(v)).digest("hex"),
    ]),
  );
}
