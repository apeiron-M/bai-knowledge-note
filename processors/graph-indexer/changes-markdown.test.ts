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

describe("renderChangesMarkdown: the story leads", () => {
  const digest: ChangeDigest = {
    window: { since: "2026-09-01T00:00:00.000Z", until: "2026-11-04T23:59:59.999Z" },
    scope: { q: "processor delivery" },
    totals: { created: 1, revised: 1, superseded: 1, archived: 1, reverified: 0, sourcesRevised: 0, sourcesAdded: 0, documents: 3, operations: 40 },
    groups: [],
    story: {
      growth: { notesThen: 120, notesNow: 150, newAreas: [{ id: "a3", title: "Workflow Automation" }], newMaps: [{ id: "m3", title: "Triggers", area: "Workflow Automation" }] },
      areas: [
        {
          id: "a2",
          title: "Data Processing and CQRS",
          notesThen: 40,
          notesNow: 44,
          newCount: 3,
          changedCount: 1,
          retiredCount: 1,
          mergedCount: 0,
          newClaims: [{ documentId: "n6", claim: "Processors checkpoint per batch", gist: "One cursor per batch" }],
          changedClaims: [
            {
              documentId: "n1",
              then: { claim: "Delivery is exactly once, in order", gist: null },
              now: { claim: "Delivery is at-least-once, with a crash gap", gist: null },
              why: "the outbox replays after a crash",
              replacedBy: "n9",
            },
          ],
          retiredClaims: [{ documentId: "n7", claim: "Processors poll the reactor", gist: null }],
        },
      ],
    },
    thenVsNow: {
      then: [{ documentId: "n1", claim: "Delivery is exactly once, in order", gist: null }],
      now: [{ documentId: "n9", claim: "Delivery is at-least-once, with a crash gap", gist: null }],
      unchanged: [{ documentId: "n8", claim: "Processors run in the reactor's process", gist: null }],
    },
  };

  it("puts growth, then per area what is new, what changed then → now, and what retired, before the totals", () => {
    const md = renderChangesMarkdown(digest);
    const at = (s: string) => md.indexOf(s);
    expect(md).toContain("## What the vault knows now");
    expect(md).toContain("Live notes: 120 → 150");
    expect(md).toContain("New areas: Workflow Automation");
    expect(md).toContain("New maps: Triggers (Workflow Automation)");
    expect(md).toContain("### Data Processing and CQRS — 40 → 44 notes");
    expect(md).toContain("- [[n6]] Processors checkpoint per batch — One cursor per batch");
    expect(md).toContain("- [[n1]] then “Delivery is exactly once, in order” → now “Delivery is at-least-once, with a crash gap” [[n9]] — because the outbox replays after a crash");
    expect(md).toContain("- [[n7]] Processors poll the reactor");
    expect(md).toContain("## Then vs now");
    expect(at("## What the vault knows now")).toBeLessThan(at("1 created"));
    expect(at("## Then vs now")).toBeLessThan(at("1 created"));
  });

  it("says how many more new claims an area has than it lists", () => {
    expect(renderChangesMarkdown(digest)).toContain("- …and 2 more new");
  });

  it("lists the claims that held throughout once, under Unchanged", () => {
    const md = renderChangesMarkdown(digest);
    expect(md).toContain("Unchanged:\n- [[n8]] Processors run in the reactor's process");
  });

  it("shows the gists of a description-only shift, so then and now do not read the same", () => {
    const story = digest.story;
    if (!story) throw new Error("the fixture has a story");
    const shift = { documentId: "n2", then: { claim: "Same claim", gist: "old gist" }, now: { claim: "Same claim", gist: "new gist" }, why: null };
    const md = renderChangesMarkdown({ ...digest, story: { ...story, areas: [{ ...story.areas[0], changedClaims: [shift] }] } });
    expect(md).toContain("- [[n2]] then “Same claim — old gist” → now “Same claim — new gist”");
  });

  it("says what a q resolved to, the merges it did not list, the source versions, and when a then was first recorded", () => {
    const story = digest.story;
    if (!story) throw new Error("the fixture has a story");
    const shift = { documentId: "n3", then: { claim: "Exactly once", gist: null }, now: { claim: "At least once", gist: null }, why: null, thenAt: "2026-09-02T10:00:05.000Z" };
    const area = { ...story.areas[0], mergedCount: 3, versions: { first: "v6.2.2-dev.74", now: "v6.2.3-dev.91+e0f277d" }, changedClaims: [shift] };
    const md = renderChangesMarkdown({
      ...digest,
      scope: { q: "data processing", resolved: { kind: "moc", id: "a2", title: "Data Processing and CQRS" } },
      story: { ...story, areas: [area] },
      thenVsNow: { then: [{ documentId: "n3", claim: "Exactly once", gist: null, thenAt: "2026-09-02T10:00:05.000Z" }], now: [], unchanged: [] },
    });
    expect(md).toContain("Scope: the map Data Processing and CQRS [[a2]] (matched “data processing”).");
    expect(md).toContain("Sources: v6.2.2-dev.74 → v6.2.3-dev.91+e0f277d.");
    expect(md).toContain("3 duplicate notes merged (not listed).");
    expect(md).toContain("- [[n3]] then (first recorded 2026-09-02) “Exactly once” → now “At least once”");
    expect(md).toContain("- [[n3]] Exactly once (first recorded 2026-09-02)");
    const search = renderChangesMarkdown({ ...digest, scope: { q: "delivery", resolved: { kind: "search", query: "delivery", hits: 25 } } });
    expect(search).toContain("Scope: search “delivery” — 25 hits and their linked notes.");
    const vault = renderChangesMarkdown({ ...digest, scope: { q: "Powerhouse stack", resolved: { kind: "vault", title: "Powerhouse Stack" } } });
    expect(vault).toContain("Scope: the whole vault (“Powerhouse stack” names Powerhouse Stack).");
  });

  it("says when the vault began instead of 0 notes then, when since predates it (Addendum C2)", () => {
    const story = digest.story;
    if (!story) throw new Error("the fixture has a story");
    const md = renderChangesMarkdown({ ...digest, story: { ...story, growth: { ...story.growth, notesThen: 0, from: "2026-09-02T10:00:00.000Z" } } });
    expect(md).toContain("The vault began on 2026-09-02; it holds 150 live notes now.");
    expect(md).not.toContain("Live notes: 0 →");
  });

  it("names the main areas a q matched (Addendum C1)", () => {
    const md = renderChangesMarkdown({
      ...digest,
      scope: { q: "the reactor", resolved: { kind: "areas", areas: [{ id: "a1", title: "Reactor and Drives" }, { id: "a3", title: "Reactor Sync Infrastructure" }] } },
    });
    expect(md).toContain("Scope: the areas Reactor and Drives [[a1]], Reactor Sync Infrastructure [[a3]] (matched “the reactor”).");
  });
});

