import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeHealth, type HealthInput } from "../../editors/knowledge-vault/lib/health-checks.js";
import type { VaultSeed } from "../seed.js";

const seed = JSON.parse(readFileSync(new URL("./guide-vault.json", import.meta.url), "utf8")) as VaultSeed;
type NoteState = { title: string; description: string | null; noteType: string | null; topics: { name: string }[] };

const notes = seed.documents.filter((d) => d.documentType === "bai/knowledge-note");
const noteIds = new Set(notes.map((n) => n.id));
const documentIds = new Set(seed.documents.map((d) => d.id));
const NOTE_LINK_TYPES = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"]);
const noteLinks = seed.relationships.filter((r) => noteIds.has(r.sourceId) && noteIds.has(r.targetId));

/** The guide as the health check reads it: notes, every link out of each, and maps' core ideas. */
function guideHealthInput(): HealthInput {
  return {
    notes: notes.map((n) => {
      const g = (n.state.global as NoteState);
      return {
        id: n.id,
        title: g.title,
        description: g.description,
        noteType: g.noteType,
        topics: g.topics.map((t) => t.name),
        links: seed.relationships.filter((r) => r.sourceId === n.id).map((r) => r.targetId),
      };
    }),
    mocs: seed.documents
      .filter((d) => d.documentType === "bai/moc")
      .map((m) => ({ id: m.id, coreIdeas: seed.relationships.filter((r) => r.sourceId === m.id && r.relationshipType === "CORE_IDEA").map((r) => r.targetId) })),
    pendingObservations: [],
    openTensions: [],
    otherDocumentIds: seed.documents.filter((d) => !noteIds.has(d.id)).map((d) => d.id),
  };
}

describe("the guide vault", () => {
  it("passes its own health check", () => {
    const health = computeHealth(guideHealthInput());
    expect(health.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    expect(health.overallStatus).toBe("PASS");
    expect(health.metrics.danglingLinkCount).toBe(0);
  });

  it("gives every link between notes a type, a reason and a confidence", () => {
    for (const link of noteLinks) {
      expect(NOTE_LINK_TYPES.has(link.relationshipType), `${link.sourceId} → ${link.targetId}`).toBe(true);
      expect(String(link.metadata?.reason ?? "").length, `reason of ${link.sourceId} → ${link.targetId}`).toBeGreaterThanOrEqual(20);
      expect(["grounded", "established", "speculative"]).toContain(link.metadata?.confidence);
    }
  });

  it("links only documents it holds, and never the same pair twice", () => {
    for (const r of seed.relationships) expect(documentIds.has(r.sourceId) && documentIds.has(r.targetId), `${r.sourceId} → ${r.targetId}`).toBe(true);
    const pairs = noteLinks.map((r) => `${r.sourceId}>${r.targetId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("counts its links where the queue says it linked them", () => {
    const queue = seed.documents.find((d) => d.documentType === "bai/pipeline-queue")!;
    const reflect = (queue.state.global as { tasks: { handoffs: { phase: string; workDone: string }[] }[] }).tasks[0].handoffs.find((h) => h.phase === "reflect")!;
    expect(reflect.workDone).toContain(`with ${noteLinks.length} typed links`);
  });

  it("carries the version of its content", () => {
    const { version, ...content } = seed;
    expect(version).toBe(createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 12));
  });
});
