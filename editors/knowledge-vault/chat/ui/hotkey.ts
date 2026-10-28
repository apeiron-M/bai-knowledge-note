// Moved to nl-runtime in M1 (M1-UI). This shim keeps the old path for the
// test importers; M3 retargets them and deletes it.
import {
  hotkeyStorageKey,
  type Platform,
  readBindingText as coreReadBindingText,
  saveBindingText as coreSaveBindingText,
} from "nl-runtime";

export {
  bindingLabel,
  defaultBindingText,
  detectPlatform,
  type HotkeyBinding,
  type KeyLike,
  matchesBinding,
  parseBinding,
  type Platform,
  type SheetKeyAction,
  sheetKeyAction,
} from "nl-runtime";

/** `bai.chat.hotkey`, the old UI's key. */
export const HOTKEY_STORAGE_KEY = hotkeyStorageKey("bai.chat");

export const readBindingText = (p: Platform): string => coreReadBindingText(p, "bai.chat");

export const saveBindingText = (text: string, p: Platform): boolean =>
  coreSaveBindingText(text, p, "bai.chat");
