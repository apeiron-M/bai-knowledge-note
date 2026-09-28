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
    expect(requests[1].json).toEqual({ source: "n1", target: "src", type: "DERIVED_FROM", reason: 'Extracted from "Tech": paragraph 1', confidence: "grounded" });
    const source = requests[3].json as { documentId: string; actions: { type: string; input: Record<string, unknown> }[] };
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
    const down = recordingVault({ actions: () => { throw new Error("gateway down"); } });
    const one = await writeStage(down.client, args([note(1)]));
    expect(one.summary).toBe("Wrote 1 note to /knowledge/notes, submitted for review, 1 linked to the source; the source was NOT updated (gateway down).");
    const oneBad = recordingVault({ notes: (b) => ({ notes: b.notes.map((n) => ({ id: "x", name: n.name, readBack: "skipped", operations: [] })) }) });
    expect((await writeStage(oneBad.client, args([note(1)]))).summary).toMatch(/1 note has problems/);
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
