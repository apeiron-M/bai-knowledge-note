import { describe, expect, it } from "vitest";
import { aiWorkLine } from "./pipeline-words.js";

describe("what the browser vault says its AI will do", () => {
  it("counts the sources the AI turns into notes, one after another", () => {
    expect(aiWorkLine(1)).toBe("Your AI turns this source into notes.");
    expect(aiWorkLine(3)).toBe("Your AI turns these 3 sources into notes, one after another.");
  });
});
