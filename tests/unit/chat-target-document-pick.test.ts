import { describe, expect, it } from "vitest";
import type {
  CandidateDoc,
  ContextTarget,
  DocumentTarget,
} from "../../editors/knowledge-vault/chat/context/context-frame.js";
import { driveRefContext } from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import {
  documentMentions,
  mentionedCandidates,
  resolveTargetDocument,
  routeChatTurn,
} from "../../editors/knowledge-vault/chat/core/target-document.js";

const D = "drive-1";
const cand = (id: string, docType: string, title: string, aliases?: string[]): CandidateDoc =>
  aliases ? { id, docType, title, aliases } : { id, docType, title };
const tag = (c: CandidateDoc): DocumentTarget => ({
  kind: "document",
  id: c.id,
  driveId: D,
  title: c.title,
  docType: c.docType,
});
const drive: ContextTarget = { kind: "drive", id: D, name: "Chat E2E Vault" };

const note = cand("n1", "bai/knowledge-note", "CRDT merge semantics");
const gossip = cand("n2", "bai/knowledge-note", "Gossip protocols");
const moc = cand("m1", "bai/moc", "CRDTs");
const project = cand("p1", "bai/project", "Rooftop beehives");
const plan = cand("w1", "bai/wbs", "Hive plan");
const source = cand("s1", "bai/source", "A source");
const documents = [note, gossip, moc, project, plan, source];
const supportedTypes = new Set(["bai/knowledge-note", "bai/wbs", "bai/moc", "bai/project"]);
const resolve = (
  context: ContextTarget,
  utterance: string,
  docs = documents,
  recentIds?: string[],
) => resolveTargetDocument({ context, documents: docs, supportedTypes, utterance, recentIds });

describe("resolveTargetDocument: a non-verbatim mention asks with the top 3", () => {
  it("asks for the CRDT MOC when the MOC is titled CRDTs, with the open document", () => {
    expect(resolve(tag(note), "add a core idea to the CRDT MOC")).toEqual({
      kind: "pick",
      open: tag(note),
      candidates: [tag(moc)],
      phrase: "CRDT MOC",
    });
  });

  it("reads the noun before or after the name, and map of content", () => {
    for (const u of [
      "add a question to the gossip note",
      "link it to my gossip notes",
      "add sync to the note about gossip",
      "add a core idea to the map of content called CRDT",
      "add a core idea to the CRDT map of content",
      "set the target date on the beehive project",
      "mark the suits goal done in the hives plan",
    ])
      expect(resolve(tag(note), u).kind, u).toBe("pick");
    expect(resolve(tag(note), "add sync to the note about gossip")).toMatchObject({
      candidates: [{ id: "n2" }],
      phrase: "note about gossip",
    });
  });

  it("offers at most 3 matches, best score first, then recency, then title", () => {
    const docs = [
      note,
      cand("m2", "bai/moc", "CRDT patterns"),
      cand("m3", "bai/moc", "CRDT basics"),
      cand("m4", "bai/moc", "CRDT pitfalls"),
      cand("m5", "bai/moc", "CRDTs"),
    ];
    // "crdt" meets all of "CRDTs", so it ranks first; the rest tie
    const r = resolve(tag(note), "add a core idea to the crdt MOC", docs, ["m4"]);
    expect(r).toMatchObject({ kind: "pick", open: { id: "n1" } });
    if (r.kind === "pick") expect(r.candidates.map((c) => c.id)).toEqual(["m5", "m4", "m3"]);
  });

  it("asks without the open document at drive level or when it has no ops", () => {
    expect(resolve(drive, "add a core idea to the CRDT MOC")).toEqual({
      kind: "pick",
      candidates: [tag(moc)],
      phrase: "CRDT MOC",
    });
    expect(resolve(tag(source), "add a core idea to the CRDT MOC")).toEqual({
      kind: "pick",
      candidates: [tag(moc)],
      phrase: "CRDT MOC",
    });
  });

  it("asks even when the request also points at the open document", () => {
    expect(resolve(tag(note), "link this note to the CRDT MOC")).toMatchObject({
      kind: "pick",
      open: { id: "n1" },
      candidates: [{ id: "m1" }],
    });
  });

  it("is routed as an ask, also for a question", () => {
    const u = "is this note in the CRDT MOC?";
    expect(routeChatTurn(u, resolve(tag(note), u))).toMatchObject({ kind: "pick" });
  });
});

describe("resolveTargetDocument: what a non-verbatim mention leaves alone", () => {
  it("keeps the verbatim rules first", () => {
    // one name verbatim: retarget, even with a fuzzy phrase beside it
    expect(resolve(tag(note), "add the gossip note to CRDTs")).toMatchObject({
      kind: "document",
      via: "retarget",
      target: { id: "m1" },
    });
    // several names: the open document (overview §5.1 Q1)
    expect(resolve(tag(note), "link Gossip protocols and CRDTs to the hive plan")).toMatchObject({
      kind: "document",
      via: "context",
    });
  });

  it("stays on the open document when the phrase fits it at least as well", () => {
    expect(resolve(tag(note), "tag the CRDT note with sync")).toMatchObject({ via: "context" });
    expect(resolve(tag(project), "set the target date of the beehive project")).toMatchObject({
      via: "context",
    });
  });

  it("needs a type noun of a matching type, after the, my, our or that", () => {
    for (const u of [
      "tag this with crdt", // no noun: a topic, not a document
      "add the topic crdt",
      "add a crdt note", // "a" does not refer to a document
      "tag this note with crdt", // "this note" is the pointer
      "link it to the CRDT project", // no project matches crdt
      "add the CRDT plan", // no plan matches crdt
      "add sync to the note", // a noun and no name
      "set the target date on the same project", // "same" says which, not what
    ])
      expect(resolve(tag(note), u).kind, u).toBe("document");
  });

  it("does not fire on the Connect E2E utterances", () => {
    // connect-c/E2E.md, on the note and on the project
    const utterances = [
      "add the topic vector clocks",
      "add a deliverable called honey harvest plan",
      "add a team member named Priya as beekeeper",
      "set the description to how CRDTs merge concurrent edits",
      "uhh can u tag this w/ like conflict resolution stuff pls",
      "pls make the descripton say hives on the east building roof",
      "we started on the hive inspection checklist today",
      "the volunteer rota for june got cancelled",
      "what is this note about?",
      "we're aiming to wrap this up by next friday, set that as the target date",
      "rename this note to Merging CRDTs without conflicts",
      "this one is basically a permanent note now",
      "tag this note with eventual consistency",
    ];
    for (const u of utterances)
      for (const open of [note, project]) {
        const r = resolve(tag(open), u);
        expect(r.kind === "pick", `${u} on ${open.title}`).toBe(false);
      }
  });
});

describe("documentMentions", () => {
  it("keeps the name words and the phrase as written", () => {
    expect(documentMentions("Add it to the CRDT MOC")).toEqual([
      { name: "crdt", types: ["bai/moc"], phrase: "CRDT MOC" },
    ]);
    expect(documentMentions("open our beehive project")).toEqual([
      { name: "beehive", types: ["bai/project"], phrase: "beehive project" },
    ]);
    expect(documentMentions("tag the doc called sync notes")).toEqual([
      { name: "sync", types: null, phrase: "doc called sync notes" },
    ]);
  });

  it("reads only its own type nouns", () => {
    expect(documentMentions("call the constructor")).toEqual([]);
  });

  it("knows every type the chat has ops for, and the X one", () => {
    expect(documentMentions("resolve the sediment tension").map((m) => m.types)).toEqual([
      ["bai/tension"],
    ]);
    expect(documentMentions("the e-scooter observation is done").map((m) => m.name)).toEqual([
      "e-scooter",
    ]);
    expect(documentMentions("the koji humidity one is a pattern")).toEqual([
      { name: "koji humidity", types: null, phrase: "koji humidity one" },
    ]);
    expect(documentMentions("tag the other one")).toEqual([]);
  });

  it("stops at prepositions and the pointer", () => {
    expect(documentMentions("add the topic gossip to this note")).toEqual([]);
    expect(documentMentions("move the idea into the note")).toEqual([]);
  });
});

describe("mentionedCandidates", () => {
  it("is empty when the open document fits the phrase best", () => {
    expect(
      mentionedCandidates("tag the CRDT note", [note, gossip], { openId: "n1" }).candidates,
    ).toEqual([]);
  });
});

describe("a pick keeps the other documents as ref candidates", () => {
  const u = "link this note to the CRDT MOC";
  it("the open note chosen: the matches are pinned", () => {
    const viewed = { id: note.id, docType: note.docType, title: note.title, state: {} };
    const refs = driveRefContext(viewed, documents, { utterance: u, cap: 0, keepIds: [moc.id] });
    expect(refs).toEqual([{ id: "m1", title: "CRDTs", kind: "moc" }]);
  });

  it("a match chosen: the open note is pinned", () => {
    const chosen = { id: moc.id, docType: moc.docType, title: moc.title, state: {} };
    const refs = driveRefContext(chosen, documents, { utterance: u, cap: 0, keepIds: [note.id] });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((c) => c.id === note.id)).toBe(true);
  });
});
