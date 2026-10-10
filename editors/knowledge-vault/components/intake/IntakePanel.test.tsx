import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IntakeBatch } from "../../hooks/use-intake-batch.js";
import type { IntakeFile } from "../../lib/intake-model.js";
import { IntakePanel } from "./IntakePanel.js";
import { fileOf, readyFile } from "./test-fixtures.js";

const noop = () => {};
const batchOf = (
  files: IntakeFile[],
  over: Partial<IntakeBatch> = {},
): IntakeBatch => ({
  files,
  driveId: "drive-1",
  visible: true,
  open: noop,
  close: noop,
  openId: null,
  setOpenId: noop,
  publishing: false,
  publishingId: null,
  collapsed: false,
  collapse: noop,
  expand: noop,
  refused: [],
  dismissRefused: noop,
  accepts: ["pdf", "md"],
  laneOf: (name) => (name.endsWith(".pdf") ? "models" : "other"),
  checking: false,
  setVault: noop,
  addAgain: noop,
  needsUser: 0,
  publishedCount: files.filter((f) => f.publishedIds).length,
  isComplete:
    files.length > 0 &&
    files.every((f) => f.state === "converted" && f.publishedIds !== undefined),
  working: files.some((f) => f.state === "queued" || f.state === "converting"),
  onFiles: noop,
  onRetry: noop,
  onRunOcr: noop,
  onRemove: noop,
  onToggle: noop,
  onAll: noop,
  onType: noop,
  onFolderName: noop,
  onPublish: () => Promise.resolve(true),
  onPublishAll: () => Promise.resolve(),
  onRetryAttach: () => Promise.resolve(),
  cancel: noop,
  reset: noop,
  ...over,
});

const panel = (batch: IntakeBatch) =>
  renderToStaticMarkup(<IntakePanel batch={batch} configured />);

const files = [
  readyFile([800, 900], { id: "a", name: "State-of-AI.pdf" }),
  readyFile([500], { id: "b", name: "Tech-report.pdf" }),
  fileOf({
    id: "c",
    name: "Board-pack.pdf",
    state: "converting",
    startedAt: Date.now(),
  }),
  fileOf({ id: "d", name: "Lease.pdf" }),
  readyFile([300], { id: "e", name: "notes.md", publishedIds: ["s1"] }),
];

describe("IntakePanel", () => {
  it("says where the batch is in one sentence, in the order files were added", () => {
    const html = panel(batchOf(files));
    expect(html).toContain("Adding 5 files");
    expect(html).toContain('<span class="ik-ready">2 ready for you</span>');
    expect(html).toContain("1 reading");
    expect(html).toContain("1 waiting");
    expect(html).toContain("1 added");
    const order = [
      "State-of-AI",
      "Tech-report",
      "Board-pack",
      "Lease",
      "notes",
    ].map((name) => html.indexOf(`>${name}<`));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    // The waiting file says what it waits for.
    expect(html).toContain("Waiting. Starts when Board-pack is read.");
  });

  it("offers one button for every ready file, Hide, and a way to add more", () => {
    const html = panel(batchOf(files));
    expect(html).toMatch(/>Add 2 ready files</);
    expect(html).toMatch(/>Hide</);
    expect(html).toMatch(/>Add more files</);
    expect(html).toContain("Reading carries on while you switch views");
  });

  it("has no button for all when only one file is ready", () => {
    expect(panel(batchOf(files.slice(1)))).not.toContain("ready files");
  });

  it("folds to one line when hidden, and the batch is still visibly there", () => {
    const html = panel(batchOf(files, { collapsed: true }));
    expect(html).toContain('class="bai-intake ik-folded"');
    expect(html).toContain("Adding 5 files.");
    expect(html).toMatch(/>Show</);
    expect(html).not.toContain('class="ik-rows"');
  });

  it("says when every file is added, with Done, in the same list", () => {
    const done = [
      readyFile([300, 300], { id: "a", publishedIds: ["s1", "s2"] }),
      readyFile([300], { id: "b", name: "Other.pdf", publishedIds: ["s3"] }),
    ];
    const html = panel(batchOf(done));
    expect(html).toContain("All 2 files added");
    expect(html).toContain("3 new sources, queued to become notes.");
    expect(html).toMatch(/class="ik-btn ik-btn-primary"[^>]*>Done</);
    expect(html).toContain('class="ik-rows"');
    expect(html).not.toContain('class="ik-addrow"');
  });

  it("lists the files it couldn't take, with the reason, until dismissed", () => {
    const html = panel(
      batchOf([], { refused: ["setup.dmg: the vault can't read .dmg files."] }),
    );
    expect(html).toContain("1 file wasn&#x27;t added:");
    expect(html).toContain("setup.dmg: the vault can&#x27;t read .dmg files.");
    expect(html).toContain('aria-label="Dismiss"');
  });

  it("opens empty on a drop area when asked for with no files", () => {
    const html = panel(batchOf([]));
    expect(html).toContain("Add sources");
    expect(html).toContain("Drop files here");
    expect(html).toContain("Up to 30 MB each.");
  });
});

describe("IntakePanel — a file the vault already holds", () => {
  it("counts it as needing a look, and offers Open and Add again on its row", () => {
    const held = fileOf({
      id: "h",
      name: "Report.pdf",
      state: "duplicate",
      known: {
        folderName: "Report",
        sources: 12,
        addedAt: "2026-10-10T09:00:00Z",
      },
    });
    const html = renderToStaticMarkup(
      <IntakePanel
        batch={batchOf([
          held,
          readyFile([300], { id: "r", name: "Other.pdf" }),
        ])}
        configured
        onOpenFolder={() => {}}
      />,
    );
    expect(html).toContain('<span class="ik-look">1 needs a look</span>');
    expect(html).toContain("Already in the vault.");
    expect(html).toContain("as 12 sources in Sources › Report.");
    expect(html).toMatch(/>Open</);
    expect(html).toMatch(/>Add again</);
  });

  it("says it is checking a file against the vault before reading it", () => {
    const html = panel(
      batchOf([fileOf({ id: "q", name: "New.pdf" })], { checking: true }),
    );
    expect(html).toContain("Checking whether it&#x27;s already in the vault…");
  });
});
