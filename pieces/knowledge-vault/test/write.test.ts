import { describe, expect, it } from "vitest";
import { assertWritable, slugFor, writeStage, type NoteToWrite } from "../lib/agent/write.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";
import { KnowledgeVaultApiError } from "../lib/common/errors.js";

const note = (i: number): NoteToWrite => ({ title: `Claim ${i} holds under load`, description: "why", note_type: "CONCEPT", content: "c".repeat(90), topics: ["operations", "strategy"], confidence: "grounded", locus: `paragraph ${i}` });

/** Records every request; answers like the vault's routes. */
function recordingVault(overrides: { notes?: (body: { notes: { name: string }[] }) => unknown; relationships?: (i: number) => unknown; actions?: () => unknown } = {}) {
  const requests: RequestOptions[] = [];
  let created = 0;
  let linked = 0;
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      if (o.path === "notes") {
        const body = o.json as { notes: { name: string }[] };
        if (overrides.notes) return overrides.notes(body);
        return { notes: body.notes.map((n) => ({ id: `n${++created}`, name: n.name, readBack: "confirmed", operations: [] })) };
      }
      if (o.path === "relationships") return overrides.relationships ? overrides.relationships(linked++) : { operations: [] };
      if (o.path === "actions") return overrides.actions ? overrides.actions() : { operations: [] };
      throw new Error(`unexpected ${o.path}`);
    },
  } as unknown as KnowledgeVaultClient;
  return { client, requests };
}
const args = (notes: NoteToWrite[]) => ({ drive: "d", sourceId: "src", sourceTitle: "Tech", model: "m/x", notes, rejectedCount: 2, skipRate: 0.25, now: () => new Date("2026-09-28T12:00:00Z") });

describe("write mode", () => {
  it("creates notes, submits them for review, links each to its source, and marks the source extracted", async () => {
    const { client, requests } = recordingVault();
    const out = await writeStage(client, args([note(1), note(2)]));
    expect(out.summary).toBe("Wrote 2 notes to /knowledge/notes, submitted for review, 2 linked to the source; the source is marked EXTRACTED.");
    expect(out.note_ids).toEqual(["n1", "n2"]);
    const create = requests[0].json as { drive: string; notes: { name: string; actions: { type: string; input: Record<string, unknown> }[] }[] };
    expect(create.drive).toBe("d");
    expect(create.notes[0].name).toBe("claim-1-holds-under-load");
    expect(create.notes[0].actions.map((a) => a.type)).toEqual(["SET_TITLE", "SET_DESCRIPTION", "SET_NOTE_TYPE", "SET_CONTENT", "ADD_TOPIC", "ADD_TOPIC", "SET_METADATA_FIELD", "SET_PROVENANCE", "SUBMIT_FOR_REVIEW"]);
    expect(create.notes[0].actions.at(-2)?.input).toEqual({ author: "extract-claims · m/x", sourceOrigin: "DERIVED", createdAt: "2026-09-28T12:00:00.000Z" });
    expect(create.notes[0].actions.at(-1)?.input).toMatchObject({ actor: "extract-claims · m/x", timestamp: "2026-09-28T12:00:00.000Z", comment: 'Extracted from "Tech" (paragraph 1) by m/x. Check the claim, its type and topics, then approve.' });
    expect(create.notes[1].actions.at(-1)?.input).toMatchObject({ comment: expect.stringContaining("(paragraph 2)") as unknown as string });
    // Recorded on the source straight after creation, before the links.
    expect(requests[1].json).toEqual({ documentId: "src", actions: [{ type: "ADD_EXTRACTED_CLAIM", input: { claimRef: "n1" } }, { type: "ADD_EXTRACTED_CLAIM", input: { claimRef: "n2" } }] });
    expect(requests[2].json).toEqual({ source: "n1", target: "src", type: "DERIVED_FROM", reason: 'Extracted from "Tech": paragraph 1', confidence: "grounded" });
    expect(out.incomplete).toBeNull();
    const source = requests[4].json as { documentId: string; actions: { type: string; input: Record<string, unknown> }[] };
    expect(source.documentId).toBe("src");
    expect(source.actions.map((a) => a.type)).toEqual(["ADD_EXTRACTED_CLAIM", "ADD_EXTRACTED_CLAIM", "RECORD_EXTRACTION_STATS", "SET_SOURCE_STATUS"]);
    expect(source.actions[2].input).toMatchObject({ claimCount: 2, skippedCount: 2, skipRate: 0.25 });
  });

  it("creates in batches of 25, the vault's limit", async () => {
    const { client, requests } = recordingVault();
    const out = await writeStage(client, args(Array.from({ length: 27 }, (_, i) => note(i))));
    expect(requests.filter((r) => r.path === "notes").map((r) => (r.json as { notes: unknown[] }).notes.length)).toEqual([25, 2]);
    expect(out.linked_count).toBe(27);
  });

  it("reports every problem instead of hiding it", async () => {
    const { client } = recordingVault({
      notes: (body) => ({ notes: body.notes.map((n, i) => ({ id: `n${i + 1}`, name: n.name, readBack: i === 0 ? "unconfirmed" : "confirmed", operations: i === 1 ? [{ index: 1, type: "SET_DESCRIPTION", error: "Description exceeds 200 characters" }] : [] })) }),
      relationships: (i) => { if (i === 0) throw new KnowledgeVaultApiError("reason too short", { category: "validation" }); return {}; },
      actions: () => ({ operations: [{ index: 0, type: "SET_SOURCE_STATUS", error: "bad status" }] }),
    });
    const out = await writeStage(client, args([note(1), { ...note(2), locus: "" }]));
    const withoutLocus = recordingVault();
    await writeStage(withoutLocus.client, args([{ ...note(3), locus: "" }]));
    expect(JSON.stringify(withoutLocus.requests[0].json)).toContain("(the source)");
    expect(out.written[0].problems).toEqual(["read-back unconfirmed", "DERIVED_FROM link: reason too short"]);
    expect(out.written[1].problems).toEqual(["SET_DESCRIPTION: Description exceeds 200 characters"]);
    expect(out).toMatchObject({ linked_count: 1, source_updated: false, source_problem: "SET_SOURCE_STATUS: bad status", problem_count: 2 });
    expect(out.summary).toBe("Wrote 2 notes to /knowledge/notes, submitted for review, 1 linked to the source; the source was NOT updated (SET_SOURCE_STATUS: bad status). 2 notes have problems: see written.");
    expect(out.incomplete).toBe("the source was not updated");
    const unlinked = recordingVault({ relationships: () => { throw new Error("down"); } });
    expect((await writeStage(unlinked.client, args([note(1), note(2)]))).incomplete).toBe("2 notes are not linked to the source");
    const down = recordingVault({ actions: () => { throw new Error("gateway down"); } });
    const one = await writeStage(down.client, args([note(1)]));
    expect(one.summary).toBe("Wrote 1 note to /knowledge/notes, submitted for review, 1 linked to the source; the source was NOT updated (gateway down).");
    const oneBad = recordingVault({ notes: (b) => ({ notes: b.notes.map((n) => ({ id: "x", name: n.name, readBack: "skipped", operations: [] })) }) });
    expect((await writeStage(oneBad.client, args([note(1)]))).summary).toMatch(/1 note has problems/);
  });

  it("moves a source that was never queued through EXTRACTING, which INBOX needs", async () => {
    const inbox = recordingVault();
    await writeStage(inbox.client, { ...args([note(1)]), sourceStatus: "INBOX" });
    const types = (r: RequestOptions) => (r.json as { actions: { type: string; input: { status?: string } }[] }).actions.map((a) => a.input.status ?? a.type);
    expect(types(inbox.requests.at(-1) as RequestOptions)).toEqual(["ADD_EXTRACTED_CLAIM", "EXTRACTING", "RECORD_EXTRACTION_STATS", "EXTRACTED"]);
    const unset = recordingVault();
    await writeStage(unset.client, { ...args([note(1)]), sourceStatus: null });
    expect(types(unset.requests.at(-1) as RequestOptions)).toContain("EXTRACTING");
  });

  it("refuses a source whose notes a stopped step never recorded", () => {
    expect(() => assertWritable({ title: "T", status: "EXTRACTING", extracted_claims: 0, derived_notes: 4 })).toThrow(/already has 4 extracted notes/);
    expect(() => assertWritable({ title: "T", status: "EXTRACTING", extracted_claims: 2, derived_notes: 5 })).toThrow(/already has 5/);
  });

  it("refuses a source that already has notes, or is archived", () => {
    expect(() => assertWritable({ title: "T", status: "EXTRACTED", extracted_claims: 3 })).toThrow(/already has 3 extracted notes/);
    expect(() => assertWritable({ title: "T", status: "EXTRACTED", extracted_claims: 1 })).toThrow(/1 extracted note;/);
    expect(() => assertWritable({ title: "T", status: "ARCHIVED", extracted_claims: 0 })).toThrow(/archived/);
    expect(() => assertWritable({ title: "T", status: "EXTRACTING", extracted_claims: 0 })).not.toThrow();
  });

  it("names documents readably", () => {
    expect(slugFor("Capital is not the binding constraint; conversion is.")).toBe("capital-is-not-the-binding-constraint-conversion-is");
    expect(slugFor("A".repeat(100))).toBe("a".repeat(72));
    expect(slugFor("!!!")).toBe("note");
    expect(slugFor("Légacy systems — and more words than fit in the name of a single document in a drive")).toBe("legacy-systems-and-more-words-than-fit-in-the-name-of-a-single-document");
  });
});

describe("a claim from two sources, and a source with no knowledge", () => {
  type Sent = { actions: { type: string; input: Record<string, unknown> }[] };
  it("links a claim the vault already holds to this source, lists it, and counts it", async () => {
    const { client, requests } = recordingVault();
    const out = await writeStage(client, { ...args([note(1)]), existing: [{ note_id: "old7", title: "Old", locus: "p2", evidence: "the passage" }] });
    const links = requests.filter((r) => r.path === "relationships").map((r) => r.json);
    expect(links[1]).toEqual({ source: "old7", target: "src", type: "DERIVED_FROM", reason: 'Also argued in "Tech" (p2): "the passage"', confidence: "grounded" });
    const last = requests.at(-1)!.json as Sent;
    expect(last.actions.map((a) => [a.type, a.input.claimRef ?? a.input.status ?? a.input.claimCount])).toEqual([
      ["ADD_EXTRACTED_CLAIM", "n1"], ["ADD_EXTRACTED_CLAIM", "old7"], ["RECORD_EXTRACTION_STATS", 2], ["SET_SOURCE_STATUS", "EXTRACTED"],
    ]);
    expect(last.actions[2].input.extractedBy).toBe("extract-claims 2 · m/x");
    expect(out.linked_existing).toEqual(["old7"]);
    expect(out.summary).toBe("Wrote 1 note to /knowledge/notes, submitted for review, 1 linked to the source; 1 note already in the vault now also links to it; the source is marked EXTRACTED.");
  });
  it("archives a source that holds no knowledge, and only when no claim was found", async () => {
    const empty = recordingVault();
    const out = await writeStage(empty.client, { ...args([]), archiveReason: "a list of references" });
    const actions = (empty.requests.at(-1)!.json as Sent).actions;
    expect(actions.map((a) => a.type)).toEqual(["RECORD_EXTRACTION_STATS", "SET_SOURCE_STATUS"]);
    expect(actions[1].input).toEqual({ status: "ARCHIVED" });
    expect(out).toMatchObject({ archived: true, summary: 'Nothing in "Tech" is knowledge; the source is archived: a list of references.' });
    const linked = recordingVault();
    await writeStage(linked.client, { ...args([]), archiveReason: "a list of references", existing: [{ note_id: "old7", title: "Old", locus: "", evidence: "" }] });
    expect((linked.requests.at(-1)!.json as Sent).actions.at(-1)!.input).toEqual({ status: "EXTRACTED" });
    expect((linked.requests.find((r) => r.path === "relationships")!.json as { reason: string }).reason).toBe('Also argued in "Tech" (the source)');
  });
  it("leaves an existing note off the source's list when its link fails, and says so", async () => {
    const { client, requests } = recordingVault({ relationships: (i) => { if (i === 1) throw new KnowledgeVaultApiError("400: reason too short", { category: "validation" }); return { operations: [] }; } });
    const out = await writeStage(client, { ...args([note(1)]), existing: [{ note_id: "old7", title: "Old", locus: "p", evidence: "e" }] });
    const actions = (requests.at(-1)!.json as Sent).actions;
    expect(actions.filter((a) => a.type === "ADD_EXTRACTED_CLAIM").map((a) => a.input.claimRef)).toEqual(["n1"]);
    expect(out.existing_problems).toEqual(["Old: 400: reason too short"]);
    expect(out.summary).toMatch(/1 existing note could not be linked: Old: 400: reason too short\./);
  });
  it("links an existing note once when two claims found it, so the count matches the list", async () => {
    const { client, requests } = recordingVault();
    const out = await writeStage(client, { ...args([note(1)]), existing: [{ note_id: "old7", title: "Old", locus: "p2", evidence: "a" }, { note_id: "old7", title: "Old", locus: "p5", evidence: "b" }] });
    expect(requests.filter((r) => r.path === "relationships" && (r.json as { source: string }).source === "old7")).toHaveLength(1);
    const actions = (requests.at(-1)!.json as Sent).actions;
    expect(actions.filter((a) => a.type === "ADD_EXTRACTED_CLAIM").map((a) => a.input.claimRef)).toEqual(["n1", "old7"]);
    expect(actions.find((a) => a.type === "RECORD_EXTRACTION_STATS")!.input.claimCount).toBe(2);
    expect(out.linked_existing).toEqual(["old7"]);
  });
  it("says the step is incomplete, and does not archive, when a claim found in the vault could not be linked", async () => {
    const failing = () => recordingVault({ relationships: () => { throw new KnowledgeVaultApiError("400: reason too short", { category: "validation" }); } });
    const linked = failing();
    const out = await writeStage(linked.client, { ...args([]), existing: [{ note_id: "old7", title: "Old", locus: "p", evidence: "e" }] });
    expect(out.incomplete).toBe("1 note already in the vault could not be linked to the source");
    const archived = failing();
    const out2 = await writeStage(archived.client, { ...args([]), archiveReason: "a list of references", existing: [{ note_id: "old7", title: "Old", locus: "p", evidence: "e" }] });
    expect((archived.requests.at(-1)!.json as Sent).actions.at(-1)!.input).toEqual({ status: "EXTRACTED" });
    expect(out2.archived).toBe(false);
  });
});
