import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  altStepDelta,
  stepId,
  VaultContextList,
} from "./VaultContextList.js";

describe("VaultContextList", () => {
  it("steps through the list and wraps at both ends", () => {
    const ids = ["a", "b", "c"];
    expect(stepId(ids, "a", 1)).toBe("b");
    expect(stepId(ids, "c", 1)).toBe("a");
    expect(stepId(ids, "a", -1)).toBe("c");
    expect(stepId(ids, undefined, 1)).toBe("a");
    expect(stepId(ids, undefined, -1)).toBe("c");
    expect(stepId(ids, "gone", 1)).toBe("a");
    expect(stepId([], undefined, 1)).toBeUndefined();
  });

  it("maps Alt+ArrowUp and Alt+ArrowDown to a step, and nothing else", () => {
    expect(altStepDelta("ArrowDown", true, false)).toBe(1);
    expect(altStepDelta("ArrowUp", true, false)).toBe(-1);
    expect(altStepDelta("ArrowDown", false, false)).toBeUndefined();
    expect(altStepDelta("Enter", true, false)).toBeUndefined();
    expect(altStepDelta("ArrowDown", true, true)).toBeUndefined();
  });

  it("names the destination in the reader's words and offers stepping", () => {
    const html = renderToStaticMarkup(
      <VaultContextList
        place="sources"
        title="State of AI Report 2026"
        subtitle="74 sources, all read"
        items={[{ id: "s1", label: "A section", detail: "12 notes" }]}
        activeId="s1"
        onOpen={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain("All sources");
    expect(html).toContain('aria-label="Previous"');
    expect(html).toContain('aria-label="Next"');
    expect(html).toContain("12 notes");
    expect(html).toContain('aria-current="true"');
  });

  it("gives each place its own back label", () => {
    const back = (place: "topics" | "graph") =>
      renderToStaticMarkup(
        <VaultContextList
          place={place}
          title="t"
          subtitle="s"
          items={[]}
          onOpen={() => {}}
          onBack={() => {}}
        />,
      );
    expect(back("topics")).toContain("All topics");
    expect(back("graph")).toContain("Back to the graph");
  });

  it("marks only the active row as current", () => {
    const html = renderToStaticMarkup(
      <VaultContextList
        place="topics"
        title="t"
        subtitle="s"
        items={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        activeId="b"
        onOpen={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("renders the header above the list when one is given", () => {
    const html = renderToStaticMarkup(
      <VaultContextList
        place="graph"
        title="t"
        subtitle="s"
        items={[]}
        onOpen={() => {}}
        onBack={() => {}}
        header={<p>Why they connect</p>}
      />,
    );
    expect(html).toContain("Why they connect");
    expect(html.indexOf("Why they connect")).toBeLessThan(
      html.indexOf('role="listbox"'),
    );
  });
});
