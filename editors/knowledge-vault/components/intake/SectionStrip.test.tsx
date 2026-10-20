import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MAX_TILES, SectionStrip, stripTiles } from "./SectionStrip.js";

describe("SectionStrip", () => {
  it("draws a tile per section while they fit, and groups a long file's so the bar keeps its width", () => {
    // Few sections: one tile each, kept or left out.
    expect(stripTiles([10, 20, 30], [true, false, true], MAX_TILES.row).map((t) => t.state)).toEqual(["on", "off", "on"]);

    // A 922-section book with two left out: at most 36 tiles, every section in exactly one.
    const n = 922;
    const kept = Array.from({ length: n }, (_, i) => i !== 5 && i !== 600);
    const tiles = stripTiles(Array.from({ length: n }, () => 100), kept, MAX_TILES.row);
    expect(tiles).toHaveLength(36);
    expect(tiles[0]?.first).toBe(0);
    expect(tiles.at(-1)?.last).toBe(n - 1);
    tiles.slice(1).forEach((t, i) => expect(t.first).toBe((tiles[i]?.last ?? 0) + 1));
    // A run holding a left-out section is half kept; the rest are whole.
    expect(tiles.filter((t) => t.state === "mixed")).toHaveLength(2);
    expect(tiles.filter((t) => t.state === "on")).toHaveLength(34);

    // The review's map lights the run that holds the section being read, and says the bar is grouped.
    const html = renderToStaticMarkup(
      <SectionStrip weights={Array.from({ length: n }, () => 100)} kept={kept} size="map" here={600} onPick={() => {}} />,
    );
    expect(html).toContain("data-grouped");
    expect(html.match(/<button/g)).toHaveLength(MAX_TILES.map);
    expect(html.match(/ik-here/g)).toHaveLength(1);
  });
});
