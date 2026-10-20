import { describe, expect, it } from "vitest";
import { takeInWhenIdle } from "./take-in-when-idle.js";

/** A text box stand-in: its value, and the document whose focus it reads. */
function box(value: string, focused = false) {
  const doc = { activeElement: null as unknown };
  const el = { value, ownerDocument: doc } as unknown as HTMLTextAreaElement;
  if (focused) doc.activeElement = el;
  return el;
}

describe("takeInWhenIdle", () => {
  it("replaces the text of a box nobody is editing", () => {
    const el = box("old");
    expect(takeInWhenIdle(el, "new")).toBe(true);
    expect(el.value).toBe("new");
  });

  it("never replaces what someone is typing", () => {
    const el = box("half-typed", true);
    expect(takeInWhenIdle(el, "from elsewhere")).toBe(false);
    expect(el.value).toBe("half-typed");
  });

  it("does nothing when the text already matches", () => {
    expect(takeInWhenIdle(box("same"), "same")).toBe(false);
  });
});
