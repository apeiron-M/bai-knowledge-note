// Moved to nl-runtime in M1 (M1-UI): the hook is `useChatLlm`, mounted
// through `ChatSheet` (components/ChatSheet.tsx). This file keeps the
// vault's settings keys (prefix `bai.chat`) and its measured numbers, with
// the old names the tests import.
import {
  type ChatMeasured,
  type ChatSettings,
  loraAloneText as coreLoraAloneText,
  readChatSettings as coreReadChatSettings,
  settingKeys,
} from "nl-runtime";
import { C_MEASURED } from "../chat/core/model-manifest.js";

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

/** Configuration C's measured numbers, for the configuration line. */
export const VAULT_MEASURED: ChatMeasured = C_MEASURED;

export const SETTING_KEYS = settingKeys(VAULT_STORAGE_PREFIX);

export function readChatSettings(): ChatSettings {
  return coreReadChatSettings(VAULT_STORAGE_PREFIX);
}

export const loraAloneText = (reason: string): string =>
  coreLoraAloneText(reason, VAULT_MEASURED);
