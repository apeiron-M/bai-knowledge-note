// Moved to nl-runtime in M1 (M1-UI): the hook is `useChatLlm`, mounted
// through `ChatSheet` (components/ChatSheet.tsx). This file keeps the
// vault's settings keys (prefix `bai.chat`), its measured numbers and the
// pre-C model URL drop (until M5), with the old names the tests import.
import {
  type ChatMeasured,
  type ChatSettings,
  loraAloneText as coreLoraAloneText,
  readChatSettings as coreReadChatSettings,
  settingKeys,
} from "nl-runtime";
import { C_HELDOUT6 } from "../chat/core/model-manifest.js";
import { isRound8Url } from "../chat/core/model-source.js";

export {
  type ChatLlm,
  type ChatReply,
  type ChatSettings,
  type ChatStage,
  type ChatTurnTiming,
  type ConfigLabel,
  deviceMemoryGb,
  kevReasonText,
  type ModelPhase,
  type ModelState,
  type PendingChoice,
  type ProposedAction,
  type Provenance,
} from "nl-runtime";

/** The vault's storage prefix: localStorage `bai.chat.*`, IndexedDB `bai-chat-history`. */
export const VAULT_STORAGE_PREFIX = "bai.chat";

/** Configuration C's held-out-6 numbers, for the configuration line. */
export const VAULT_MEASURED: ChatMeasured = { set: "held-out-6", ...C_HELDOUT6 };

export const SETTING_KEYS = {
  ...settingKeys(VAULT_STORAGE_PREFIX),
  /** Pre-C single-model URL: removed, never migrated to `loraUrl`. */
  legacyModelUrl: "bai.chat.modelUrl",
  /** A dropped custom pre-C URL, shown once in the tab. */
  legacyDropped: "bai.chat.legacyModelUrlDropped",
} as const;

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null || value === "") storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

/**
 * Drop the pre-C `bai.chat.modelUrl`. It was v1's single model (usually
 * the round 8 export), not configuration C's LoRA, so migrating it made the
 * tab run "Custom models"; C's manifest is the default instead. A custom
 * (non round 8) URL is kept for a one-time notice when no LoRA URL is set.
 */
export function dropLegacyModelUrl(): void {
  const legacy = read(SETTING_KEYS.legacyModelUrl);
  if (!legacy) return;
  write(SETTING_KEYS.legacyModelUrl, null);
  if (!isRound8Url(legacy) && !read(SETTING_KEYS.loraUrl))
    write(SETTING_KEYS.legacyDropped, legacy);
}

/** The dropped custom pre-C model URL to tell the user about, else null. */
export function legacyModelNotice(): string | null {
  return read(SETTING_KEYS.legacyDropped);
}

export function dismissLegacyModelNotice(): void {
  write(SETTING_KEYS.legacyDropped, null);
}

export function readChatSettings(): ChatSettings {
  dropLegacyModelUrl();
  return coreReadChatSettings(VAULT_STORAGE_PREFIX);
}

export const loraAloneText = (reason: string): string =>
  coreLoraAloneText(reason, VAULT_MEASURED);
