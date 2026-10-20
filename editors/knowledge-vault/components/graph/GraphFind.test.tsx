/**
 * The graph's find box: from the second character it lists up to eight nodes
 * whose title contains the text, maps of content marked "topic".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphFind } from "./GraphFind.js";
import {
  buildGraphModel,
  findNodes,
  indexGraph,
  type GraphNoteInput,
} from "./model.js";

const note = (id: string, title: string): GraphNoteInput => ({
  id,
  name: `${id}-slug`,
  title,
  status: "CANONICAL",
  links: [],
});
const g = indexGraph(
  buildGraphModel(
    [note("x", "Building agents"), note("y", "Agents first")],
    [{ id: "t", title: "Agent topics", tier: "TOPIC", coreIdeas: [], childRefs: [] }],
  ),
);
const noop = () => {};
const find = (initialQuery: string) =>
  renderToStaticMarkup(
    <GraphFind
      search={(q) => findNodes(g, q)}
      onChoose={noop}
      initialQuery={initialQuery}
    />,
  );
const options = (html: string) =>
  [
    ...html.matchAll(
      /<li[^>]*role="option" aria-selected="(true|false)" data-node-id="([^"]+)"[^>]*>(.*?)<\/li>/g,
    ),
  ].map((m) => ({
    id: m[2],
    selected: m[1] === "true",
    topic: m[3].includes(">topic</span>"),
  }));

describe("GraphFind", () => {
  it("is a labelled box with the spec's placeholder, and lists nothing before the second character", () => {
    for (const q of ["", "a"]) {
      const html = find(q);
      expect(html).toContain('placeholder="Find a note or topic"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain('role="listbox"');
    }
  });

  it("lists the matches, the first one ready for Enter, maps of content marked topic", () => {
    const html = find("agent");
    expect(html).toContain('aria-expanded="true"');
    expect(options(html)).toEqual([
      { id: "y", selected: true, topic: false },
      { id: "t", selected: false, topic: true },
      { id: "x", selected: false, topic: false },
    ]);
  });
});
