import { deriveDocumentId } from "@powerhousedao/shared/document-model";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redateSeed } from "./seed-dates.js";
import type { VaultSeed } from "./seed.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const guide = () => JSON.parse(readFileSync(new URL("./seed/guide-vault.json", import.meta.url), "utf8")) as VaultSeed;
const now = new Date("2030-01-02T03:04:05.000Z");

function timestamps(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (ISO.test(value)) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => timestamps(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => timestamps(v, out));
  return out;
}
const at = (iso: string) => new Date(iso).getTime();
type G = Record<string, any>;

describe("redateSeed", () => {
  const before = guide();
  const { seed: after, ids } = redateSeed(guide(), now);
  const latest = Math.max(...timestamps(before.documents).map(at));
  const shift = now.getTime() - latest;

  it("ends the guide's history at the visit", () => {
    expect(Math.max(...timestamps(after.documents).map(at))).toBe(now.getTime());
    expect(timestamps(after.documents).every((t) => at(t) <= now.getTime())).toBe(true);
  });

  it("moves every date by the same amount", () => {
    const pairs: [unknown, unknown][] = [];
    const source = (s: VaultSeed) => s.documents.find((d) => d.documentType === "bai/source")!;
    const queue = (s: VaultSeed) => s.documents.find((d) => d.documentType === "bai/pipeline-queue")!;
    const note = (s: VaultSeed) => s.documents.find((d) => d.documentType === "bai/knowledge-note")!;
    pairs.push([(source(before).state.global as G).extractionStats.extractedAt, (source(after).state.global as G).extractionStats.extractedAt]);
    pairs.push([(queue(before).state.global as G).tasks[0].handoffs[3].completedAt, (queue(after).state.global as G).tasks[0].handoffs[3].completedAt]);
    pairs.push([(note(before).state.global as G).provenance.createdAt, (note(after).state.global as G).provenance.createdAt]);
    pairs.push([note(before).created.createdAtUtcIso, note(after).created.createdAtUtcIso]);
    for (const [was, is] of pairs) expect(at(is as string) - at(was as string)).toBe(shift);
  });

  it("gives each document the id its new creation time derives", () => {
    for (const d of after.documents) {
      expect(d.id).toBe(deriveDocumentId({ documentType: d.documentType, createdAtUtcIso: d.created.createdAtUtcIso, nonce: d.created.nonce, protocolVersions: d.created.protocolVersions }));
    }
  });

  it("leaves no old id behind, in states, links or the drive's tree", () => {
    const text = JSON.stringify(after);
    for (const old of Object.keys(ids)) expect(text.includes(old)).toBe(false);
    const known = new Set(after.documents.map((d) => d.id));
    for (const r of after.relationships) expect(known.has(r.sourceId) && known.has(r.targetId)).toBe(true);
    for (const n of after.drive.nodes.filter((n) => n.kind === "file")) expect(known.has(n.id)).toBe(true);
    expect(after.drive.nodes.filter((n) => n.kind === "folder").map((n) => n.id)).toEqual(before.drive.nodes.filter((n) => n.kind === "folder").map((n) => n.id));
  });

  it("maps each of the guide's ids to this vault's, and changes no text", () => {
    expect(Object.keys(ids)).toHaveLength(before.documents.length);
    for (const d of before.documents) {
      const moved = after.documents.find((x) => x.id === ids[d.id])!;
      expect(moved.documentType).toBe(d.documentType);
      expect((moved.state.global as G).content).toEqual((d.state.global as G).content);
    }
    expect(after.version).toBe(before.version);
  });
});
