/**
 * The sheet's shortcut: ⌘J on macOS, Ctrl+Shift+Space elsewhere,
 * rebindable per browser. Bindings are strings such as "Mod+J" or
 * "Ctrl+Shift+Space"; `Mod` is ⌘ on macOS and Ctrl elsewhere. Matching
 * uses `KeyboardEvent.code`, so keyboard layouts and Shift do not change
 * the key.
 */

export type Platform = "mac" | "other";

export interface HotkeyBinding {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** A `KeyboardEvent.code`, e.g. `KeyJ`, `Space`, `Digit1`, `Slash`. */
  code: string;
}

/** The parts of a keyboard event a binding reads. */
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export const HOTKEY_STORAGE_KEY = "bai.chat.hotkey";

export function defaultBindingText(p: Platform): string {
  return p === "mac" ? "Mod+J" : "Ctrl+Shift+Space";
}

const NAMED_CODES: Record<string, string> = {
  space: "Space",
  enter: "Enter",
  slash: "Slash",
  "/": "Slash",
  period: "Period",
  ".": "Period",
  comma: "Comma",
  ",": "Comma",
  semicolon: "Semicolon",
  ";": "Semicolon",
  backquote: "Backquote",
  "`": "Backquote",
  quote: "Quote",
  "'": "Quote",
};

function codeFor(key: string): string | null {
  const k = key.toLowerCase();
  if (/^[a-z]$/.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  if (/^f([1-9]|1[0-2])$/.test(k)) return k.toUpperCase();
  return NAMED_CODES[k] ?? null;
}

/**
 * "Mod+J" → a binding for `p`, or null when the text is not a binding (no
 * key, an unknown key, or no Ctrl, ⌘ or Alt: a bare key would fire while
 * typing).
 */
export function parseBinding(text: string, p: Platform): HotkeyBinding | null {
  const parts = text
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const code = codeFor(key);
  if (!code) return null;
  const b: HotkeyBinding = { ctrl: false, meta: false, alt: false, shift: false, code };
  for (const m of parts.map((x) => x.toLowerCase())) {
    if (m === "mod") {
      if (p === "mac") b.meta = true;
      else b.ctrl = true;
    } else if (m === "ctrl" || m === "control") b.ctrl = true;
    else if (m === "cmd" || m === "meta" || m === "⌘") b.meta = true;
    else if (m === "alt" || m === "option") b.alt = true;
    else if (m === "shift") b.shift = true;
    else return null;
  }
  return b.ctrl || b.meta || b.alt ? b : null;
}

export function matchesBinding(e: KeyLike, b: HotkeyBinding): boolean {
  return (
    e.code === b.code &&
    e.ctrlKey === b.ctrl &&
    e.metaKey === b.meta &&
    e.altKey === b.alt &&
    e.shiftKey === b.shift
  );
}

function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const sym: Record<string, string> = {
    Slash: "/",
    Period: ".",
    Comma: ",",
    Semicolon: ";",
    Backquote: "`",
    Quote: "'",
  };
  return sym[code] ?? code;
}

/** "⌘J" on macOS; "Ctrl+Shift+Space" elsewhere. */
export function bindingLabel(b: HotkeyBinding, p: Platform): string {
  const key = keyLabel(b.code);
  if (p === "mac")
    return `${b.ctrl ? "⌃" : ""}${b.alt ? "⌥" : ""}${b.shift ? "⇧" : ""}${b.meta ? "⌘" : ""}${key}`;
  return [b.ctrl && "Ctrl", b.alt && "Alt", b.shift && "Shift", b.meta && "Meta", key]
    .filter(Boolean)
    .join("+");
}

export function detectPlatform(): Platform {
  try {
    if (typeof navigator === "undefined") return "other";
    const uad: unknown = "userAgentData" in navigator ? navigator.userAgentData : undefined;
    const fromUad =
      typeof uad === "object" && uad !== null && "platform" in uad && typeof uad.platform === "string"
        ? uad.platform
        : "";
    const p = fromUad || navigator.platform;
    return /mac|iphone|ipad|ipod/i.test(p) ? "mac" : "other";
  } catch {
    return "other";
  }
}

/** The stored binding text, or the platform default. */
export function readBindingText(p: Platform): string {
  try {
    const v = globalThis.localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (v && parseBinding(v, p)) return v;
  } catch {
    // storage blocked: use the default
  }
  return defaultBindingText(p);
}

/** Stores `text` (empty restores the default); false when it does not parse. */
export function saveBindingText(text: string, p: Platform): boolean {
  if (text.trim() && !parseBinding(text, p)) return false;
  try {
    if (text.trim()) globalThis.localStorage.setItem(HOTKEY_STORAGE_KEY, text.trim());
    else globalThis.localStorage.removeItem(HOTKEY_STORAGE_KEY);
  } catch {
    // storage blocked: the binding lasts for this page only
  }
  return true;
}

export type SheetKeyAction = "open" | "focus" | "collapse" | null;

/**
 * What a keydown does to the sheet. The binding works from anywhere, also
 * while typing in an editor field: it opens the sheet, moves focus into an
 * open sheet, or collapses it when focus is already there. Esc collapses
 * only from inside the sheet, so dialogs and editors keep their own Esc.
 */
export function sheetKeyAction(
  e: KeyLike & { key: string },
  b: HotkeyBinding | null,
  s: { expanded: boolean; inSheet: boolean },
): SheetKeyAction {
  if (b && matchesBinding(e, b))
    return !s.expanded ? "open" : s.inSheet ? "collapse" : "focus";
  if (e.key === "Escape" && s.expanded && s.inSheet) return "collapse";
  return null;
}
