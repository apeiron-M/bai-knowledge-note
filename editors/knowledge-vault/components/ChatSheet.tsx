/**
 * The vault's chat: nl-runtime's sheet over reactor-browser, with the
 * vault's chat manifest, configuration C's artifacts and the vault's
 * wording, theme and storage (`bai.chat`). Rendered by `DriveExplorer`, so
 * it persists while a document editor is open and the tag follows
 * navigation.
 */
import { useState } from "react";
import {
  type ChatDocument,
  type ChatLabels,
  type ChatParityHooks,
  type ChatTheme,
  type CreateIntent,
  type ModelEnv,
} from "nl-runtime";
import { ReactorBrowserChatSheet } from "nl-runtime/reactor-browser";
import { VAULT_ARTIFACTS } from "../chat/vault-artifacts.js";
import { VAULT_MANIFEST } from "../chat/vault-manifest.js";
import { vaultChatModels } from "../hooks/chat-models.js";
import { VAULT_MEASURED, VAULT_STORAGE_PREFIX } from "../hooks/use-chat-llm.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";

// Written as `(import.meta as …).env` so Vite sees `import.meta.env` and
// fills it (an alias such as `const meta = import.meta` stays undefined).
type MetaEnv = { env?: Record<string, string | boolean | undefined> };
const envString = (v: string | boolean | undefined) => (typeof v === "string" ? v : undefined);

const ENV: ModelEnv = {
  loraUrl: envString((import.meta as MetaEnv).env?.VITE_CHAT_LORA_URL),
  kevUrl: envString((import.meta as MetaEnv).env?.VITE_CHAT_KEV_URL),
  modelUrl: envString((import.meta as MetaEnv).env?.VITE_CHAT_MODEL_URL),
  baseUrl: envString((import.meta as MetaEnv).env?.VITE_CHAT_MODEL_BASE_URL),
};

/** A dev build (Studio): timings and the parity check, on `window.__baiChat*`. */
const DEV = (import.meta as MetaEnv).env?.DEV === true;

const LABELS: Partial<ChatLabels> = {
  placeholder: 'e.g. "tag this note with distributed systems", or ask a question',
  answerSystemPrompt: "You are a concise assistant inside a personal knowledge vault.",
  pairName: "m2bv × Kev-FT",
  useKevText:
    "Use decision model (Kev-FT). Both models take about 3.5–4 GB of memory (the decision model about 3 GB); without it the tab runs the LoRA alone and never asks.",
};

/** The vault's ten `--bai-*` colours; warning and danger keep the defaults. */
const THEME: ChatTheme = {
  border: "var(--bai-border)",
  surface: "var(--bai-surface)",
  text: "var(--bai-text)",
  textSecondary: "var(--bai-text-secondary)",
  textTertiary: "var(--bai-text-tertiary)",
  textMuted: "var(--bai-text-muted)",
  textFaint: "var(--bai-text-faint)",
  hover: "var(--bai-hover)",
  accent: "var(--bai-accent)",
  accentText: "var(--bai-accent-text)",
};

/** `window.__baiChatParityC()`, installed from chat/dev/parity-c.ts; dev builds only. */
const PARITY: ChatParityHooks | undefined = DEV
  ? {
      install: async (getDeps) =>
        (await import("../chat/dev/parity-c.js")).installParityC(getDeps),
      run: async (mode) => {
        if (!window.__baiChatParityC) throw new Error("parity check not installed");
        return window.__baiChatParityC(mode);
      },
      globalName: "__baiChatParityC",
    }
  : undefined;

/** A project's linked plan, for the manifest's crossDocument hook. */
const linkedPlanId = (d: ChatDocument): string | undefined =>
  d.docType === "bai/project" && typeof d.state.wbsRef === "string" && d.state.wbsRef
    ? d.state.wbsRef
    : undefined;

export function ChatSheet() {
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);

  return (
    <>
      <ReactorBrowserChatSheet
        chatManifest={VAULT_MANIFEST}
        artifacts={VAULT_ARTIFACTS}
        models={vaultChatModels()}
        storagePrefix={VAULT_STORAGE_PREFIX}
        env={ENV}
        dev={DEV}
        labels={LABELS}
        measured={VAULT_MEASURED}
        theme={THEME}
        parity={PARITY}
        timingsGlobal={DEV ? "__baiChatTimings" : undefined}
        linkedDocumentId={linkedPlanId}
        onCreate={setCreateIntent}
      />
      {/* outside the sheet, so its own Esc handler gets the key */}
      <CreateDocumentDialog
        open={!!createIntent}
        documentType={createIntent?.docType ?? ""}
        documentTypeLabel={createIntent?.label ?? ""}
        onClose={() => setCreateIntent(null)}
      />
    </>
  );
}
