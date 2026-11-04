import { describe, expect, it } from "vitest";
import { buildChanges, type ChangeDigest } from "./changes.js";
import { renderChangesMarkdown } from "./changes-markdown.js";
import { fixtureContext, loadChangesFixture } from "../../tests/fixtures/changes/load.js";

const fixture = loadChangesFixture();

describe("renderChangesMarkdown", () => {
  it("renders the fixture digest: totals, groups with highlights, events, next page", () => {
    const digest = buildChanges(fixture.rows, fixture.baseline, fixtureContext(), fixture.window, {
      scope: { moc: fixture.moc.id },
      limit: 8,
    });
    const md = renderChangesMarkdown(digest);
    expect(md.startsWith(`# Changes ${fixture.window.since} → ${fixture.window.until}\n`)).toBe(true);
    expect(md).toContain("## Data Processing and CQRS");
    expect(md).toContain("## Changes");
    expect(md).toContain(`Next page: cursor=${digest.nextCursor}`);
    expect(md).toMatchSnapshot();
  });

  it("says nothing changed for an empty digest", () => {
    const empty: ChangeDigest = {
      window: { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" },
      scope: {},
      totals: { created: 0, revised: 0, superseded: 0, archived: 0, reverified: 0, sourcesRevised: 0, sourcesAdded: 0, documents: 0, operations: 0 },
      groups: [],
    };
    expect(renderChangesMarkdown(empty)).toBe(
      "# Changes 2026-11-03T00:00:00.000Z → 2026-11-03T23:59:59.999Z\n\nNothing changed in this window.\n",
    );
  });
});

describe("renderChangesMarkdown: sources", () => {
  it("says a source's earlier version was not recorded rather than '0 lines', and counts all its notes", () => {
    const S = "bai/source";
    const row = (input: Record<string, unknown>, timestamp: string) => ({ documentId: "s1", documentType: S, operationType: "INGEST_SOURCE", timestamp, index: 0, inputJson: JSON.stringify(input), signerAddress: null });
    const claimIds = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const ctx = { ...fixtureContext(), sources: new Map([["s1", { title: "Guide", folder: null, claimIds, addedAt: "2026-08-01T00:00:00.000Z" }]]) };
    const window = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };
    const digest = buildChanges([row({ title: "Guide", content: "b", method: "git:v2" }, "2026-11-03T01:00:00.000Z")], [], ctx, window, { scope: { documentIds: ["s1"] } });
    expect(renderChangesMarkdown(digest)).toContain("? → v2, earlier version not recorded, 30 notes");
  });
});
