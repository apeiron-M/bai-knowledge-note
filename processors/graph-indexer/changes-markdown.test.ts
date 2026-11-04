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
