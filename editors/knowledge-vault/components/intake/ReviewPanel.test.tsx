import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setHostConfig } from "../../../shared/host-config.js";
import {
  FORMULA_PLACEHOLDER,
  PICTURE_PLACEHOLDER,
} from "../../lib/intake-attachments.js";
import type { IntakeFile } from "../../lib/intake-model.js";
import { ReviewSheet } from "./ReviewPanel.js";
import {
  convertedOf,
  figureOf,
  fileOf,
  readyFile,
  section,
} from "./test-fixtures.js";

const sheet = (
  file: IntakeFile,
  {
    publishingId = null,
    canPublish = true,
  }: { publishingId?: string | null; canPublish?: boolean } = {},
) =>
  renderToStaticMarkup(
    <ReviewSheet
      file={file}
      publishingId={publishingId}
      canPublish={canPublish}
      onClose={() => {}}
      onToggle={() => {}}
      onAll={() => {}}
      onType={() => {}}
      onFolderName={() => {}}
      onPublish={() => {}}
      onRunOcr={() => {}}
    />,
  );

const addButton = (html: string) =>
  html.match(
    /<button[^>]*class="ik-btn ik-btn-primary ik-btn-big"[^>]*>([^<]*)<\/button>/,
  );

describe("ReviewSheet — checking one file", () => {
  const report = fileOf({
    name: "2026-global-tech-report.pdf",
    state: "converted",
    folderName: "2026-global-tech-report",
    selected: [true, true, true],
    converted: convertedOf(
      [
        section("Foreword", "Foreword text."),
        section(
          "Technology maturity and strategy",
          "Leaders say their programmes are maturing.",
        ),
        section("Tech investment", "Investment text."),
      ],
      {
        pages: 23,
        quality: {
          coverage: 0.797,
          rawTokens: 1,
          formulas: { total: 0, decoded: 0 },
          images: 37,
        },
      },
    ),
  });

  it("says how the file was split, what it is, and what to watch for", () => {
    const html = sheet(report);
    expect(html).toContain(
      "Split at its headings into 3 sections. Each section you keep becomes one source.",
    );
    expect(html).toContain("PDF, 736.0 KB, 23 pages.");
    expect(html).toContain("About 80% of this file&#x27;s text was captured.");
    expect(html).toContain('role="dialog"');
    // The file's bar, as a map, with the section being read lit.
    expect(html).toContain('data-size="map"');
    expect(html).toMatch(/class="ik-here"/);
  });

  it("shows a section's title once, not again as the first line of its text", () => {
    const file = readyFile([1], {}, {});
    file.converted?.sections.splice(
      0,
      1,
      section("Tech investment", "## Tech investment\n\nBudgets move."),
    );
    const html = sheet(file);
    // Once each: the list, the reader's title and the checkbox's label — never in the text.
    expect(html.match(/Tech investment/g)?.length).toBe(3);
    expect(html).not.toContain('class="md-h2"');
    expect(html).toContain("Budgets move.");
  });

  it("opens on the first kept section and shows it", () => {
    const html = sheet({ ...report, selected: [false, true, true] });
    expect(html).toMatch(
      /aria-current="true"[^>]*>Technology maturity and strategy/,
    );
    expect(html).toContain("Leaders say their programmes are maturing.");
    expect(html).toContain("2 of 3");
  });

  it("says where the sources go and what nothing is written before", () => {
    const html = sheet(report);
    expect(html).toContain("Sources › 2026-global-tech-report");
    expect(html).toContain("as articles.");
    expect(html).toContain("Nothing is added until you click Add.");
    expect(addButton(html)?.[1]).toBe("Add 3 sources");
    expect(html).toContain("3 kept");
  });

  it("holds Add, and says why, when nothing is kept", () => {
    const html = sheet({ ...report, selected: [false, false, false] });
    const add = addButton(html);
    expect(add?.[0]).toContain("disabled");
    expect(add?.[0]).toContain(
      'title="Keep at least one section to add this file."',
    );
  });

  it("shows Adding… while it adds, and the reason when adding failed", () => {
    expect(addButton(sheet(report, { publishingId: report.id }))?.[1]).toBe(
      "Adding…",
    );
    const failed = sheet({
      ...report,
      publishError: "The vault did not answer.",
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Couldn&#x27;t add it: The vault did not answer.");
  });

  it("says a contents page starts left out, and why", () => {
    const file = readyFile([400, 4000], { selected: [false, true] });
    file.converted?.sections.splice(0, 1, section("Contents", 400));
    expect(sheet(file)).toContain("Usually skipped, so it starts left out");
  });

  it("says a file with no headings stays whole, and draws no map for one section", () => {
    const html = sheet(readyFile([1200]));
    expect(html).toContain("It has no headings to split at, so it stays whole");
    expect(html).not.toContain('data-size="map"');
  });

  it("shows a section's figures themselves, where the source will carry them", () => {
    const file = fileOf({
      state: "converted",
      selected: [true],
      converted: convertedOf(
        [
          {
            ...section(
              "Results",
              `Before.\n\n${PICTURE_PLACEHOLDER}\n\nAfter.\n\n${FORMULA_PLACEHOLDER}\n`,
            ),
            placeholderBase: { picture: 0, formula: 0 },
          },
        ],
        { figures: [figureOf("picture", 0), figureOf("formula", 0)] },
      ),
    });
    const html = sheet(file);
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain("Kept as an image");
    expect(html.indexOf("Before.")).toBeLessThan(html.indexOf("<img"));
    expect(html.lastIndexOf("<img")).toBeGreaterThan(html.indexOf("After."));
  });
});

describe("the review sheet in the browser vault", () => {
  afterEach(() => setHostConfig(undefined));
  it("says the visitor's AI turns the kept sections into notes, one after another", () => {
    setHostConfig({ kind: "browser", switchboardOrigin: "https://knowledge-vault.invalid" });
    expect(sheet(readyFile([300, 300, 300]))).toContain("Your AI turns these 3 sources into notes, one after another.");
  });
  it("says nothing about an AI elsewhere", () => {
    expect(sheet(readyFile([300, 300, 300]))).not.toContain("Your AI turns");
  });
});
