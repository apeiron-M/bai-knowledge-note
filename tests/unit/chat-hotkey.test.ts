import { describe, expect, it } from "vitest";
import {
  bindingLabel,
  defaultBindingText,
  matchesBinding,
  parseBinding,
  sheetKeyAction,
  type HotkeyBinding,
  type Platform,
} from "../../editors/knowledge-vault/chat/ui/hotkey.js";

const key = (
  code: string,
  mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {},
  k = "",
) => ({
  code,
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});
const def = (p: Platform): HotkeyBinding => {
  const b = parseBinding(defaultBindingText(p), p);
  if (!b) throw new Error("default does not parse");
  return b;
};

describe("hotkey bindings", () => {
  it("defaults to ⌘J on macOS and Ctrl+Shift+Space elsewhere", () => {
    expect(def("mac")).toEqual({ ctrl: false, meta: true, alt: false, shift: false, code: "KeyJ" });
    expect(bindingLabel(def("mac"), "mac")).toBe("⌘J");
    expect(def("other")).toEqual({ ctrl: true, meta: false, alt: false, shift: true, code: "Space" });
    expect(bindingLabel(def("other"), "other")).toBe("Ctrl+Shift+Space");
  });

  it("parses rebindings and rejects bare or unknown keys", () => {
    expect(parseBinding("Mod+Shift+K", "other")).toMatchObject({ ctrl: true, shift: true, code: "KeyK" });
    expect(parseBinding("Alt+/", "mac")).toMatchObject({ alt: true, code: "Slash" });
    expect(parseBinding("Cmd+1", "mac")).toMatchObject({ meta: true, code: "Digit1" });
    expect(parseBinding("J", "mac")).toBeNull();
    expect(parseBinding("Shift+J", "mac")).toBeNull();
    expect(parseBinding("Ctrl+Hyper+J", "mac")).toBeNull();
    expect(parseBinding("Ctrl+Unknown", "mac")).toBeNull();
    expect(parseBinding("", "mac")).toBeNull();
  });

  it("matches the exact modifier set, by code", () => {
    const b = def("mac");
    expect(matchesBinding(key("KeyJ", { meta: true }), b)).toBe(true);
    expect(matchesBinding(key("KeyJ", { meta: true, shift: true }), b)).toBe(false);
    expect(matchesBinding(key("KeyJ", { ctrl: true }), b)).toBe(false);
    expect(matchesBinding(key("KeyK", { meta: true }), b)).toBe(false);
    expect(matchesBinding(key("Space", { ctrl: true, shift: true }), def("other"))).toBe(true);
  });
});

describe("sheet key handler", () => {
  const b = def("mac");
  const cmdJ = key("KeyJ", { meta: true }, "j");
  const esc = key("Escape", {}, "Escape");

  it("opens from anywhere, focuses an open sheet, collapses from inside it", () => {
    expect(sheetKeyAction(cmdJ, b, { expanded: false, inSheet: false })).toBe("open");
    expect(sheetKeyAction(cmdJ, b, { expanded: true, inSheet: false })).toBe("focus");
    expect(sheetKeyAction(cmdJ, b, { expanded: true, inSheet: true })).toBe("collapse");
  });

  it("collapses on Esc only from inside an open sheet", () => {
    expect(sheetKeyAction(esc, b, { expanded: true, inSheet: true })).toBe("collapse");
    expect(sheetKeyAction(esc, b, { expanded: true, inSheet: false })).toBeNull();
    expect(sheetKeyAction(esc, b, { expanded: false, inSheet: true })).toBeNull();
  });

  it("ignores other keys and works without a binding", () => {
    expect(sheetKeyAction(key("KeyJ", {}, "j"), b, { expanded: false, inSheet: false })).toBeNull();
    expect(sheetKeyAction(cmdJ, null, { expanded: false, inSheet: false })).toBeNull();
  });
});
