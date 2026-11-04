/**
 * The change-digest fixture recorded from the live vault by
 * `scripts/record-changes-fixture.mjs` (the 2026-11-03 monorepo sync, scoped
 * to the "Data Processing and CQRS" map), and the {@link ChangeContext} its
 * context section describes.
 */
import { readFileSync } from "node:fs";
import type { ChangeContext, MocTier, OperationRow } from "../../../processors/graph-indexer/changes.js";

export type ChangesFixture = {
  window: { since: string; until: string };
  moc: { id: string; title: string };
  rows: OperationRow[];
  baseline: OperationRow[];
  context: {
    nodes: { id: string; title: string; documentType: string; status: string | null; topics: string[] }[];
    sources: { id: string; title: string; folder: string | null; addedAt: string | null; claimIds: string[] }[];
    mocsByNote: { noteId: string; id: string; title: string; tier: MocTier }[];
    derivedFrom: { noteId: string; sourceIds: string[] }[];
    edges: { source: string; target: string; type: string; reason: string }[];
  };
};

let cached: ChangesFixture | null = null;

export function loadChangesFixture(): ChangesFixture {
  cached ??= JSON.parse(readFileSync(new URL("./2026-11-03-processors.json", import.meta.url), "utf8")) as ChangesFixture;
  return cached;
}

export function fixtureContext(f: ChangesFixture = loadChangesFixture()): ChangeContext {
  const mocsByNote = new Map<string, { id: string; title: string; tier: MocTier }[]>();
  for (const m of f.context.mocsByNote) mocsByNote.set(m.noteId, [...(mocsByNote.get(m.noteId) ?? []), { id: m.id, title: m.title, tier: m.tier }]);
  return {
    nodes: new Map(f.context.nodes.map((n) => [n.id, n])),
    sources: new Map(f.context.sources.map((s) => [s.id, s])),
    mocsByNote,
    derivedFrom: new Map(f.context.derivedFrom.map((d) => [d.noteId, d.sourceIds])),
    edgeReason: (source, target, type) =>
      f.context.edges.find((e) => e.source === source && e.target === target && e.type === type)?.reason ?? null,
  };
}
