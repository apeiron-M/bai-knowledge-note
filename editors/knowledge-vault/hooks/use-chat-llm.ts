import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { generateId } from "document-model/core";
import type { Action } from "document-model";
import type { ArgsStepResult } from "../chat/core/args-step.js";
import {
  decideOp,
  fillArgs,
  type DecideResult,
  type KevFallback,
} from "../chat/core/c-pipeline.js";
import { buildAction } from "../chat/core/envelope.js";
import type { LlmClient } from "../chat/core/llm-client.js";
import type { TrieMode } from "../chat/core/lora-trie.js";
import { C_FUSION, C_HELDOUT6 } from "../chat/core/model-manifest.js";
import {
  fileNameOf,
  isRound8Url,
  resolveCSources,
  type ModelSettings,
  type ResolvedSources,
} from "../chat/core/model-source.js";
import type { CatalogEntry } from "../chat/core/op-catalog.js";
import {
  currentListsFor,
  driveRefContext,
  refCandidatesFor,
  type ChatDocument,
} from "../chat/core/ref-candidates.js";
import { v1Catalog, type RefCandidates } from "../chat/core/v1-pipeline.js";
import {
  chatModelsState,
  clearModelCache,
  ensureKev,
  ensureLora,
  kevBackendFor,
  kevBlocker,
  kevServedT,
  loraTrieBlocker,
  markKevOff,
  resetKevError,
  setChatStage,
  subscribeChatModels,
  unloadKev,
} from "./chat-models.js";

export type { ChatStage, ModelPhase, ModelState } from "./chat-models.js";

/** The user's local calendar date, `YYYY-MM-DD`. */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type OpDecision = Extract<DecideResult, { kind: "op" }>;

/** How the proposed op was chosen (shown on the card). */
export type Provenance =
  | { kind: "fused"; p: number }
  | { kind: "chosen"; from: number }
  | { kind: "lora-alone"; reason: string };

export interface ProposedAction {
  /** The request step 2 read. */
  utterance: string;
  entry: CatalogEntry;
  step2: ArgsStepResult;
  /** The document the action targets. */
  doc: ChatDocument;
  /** The labeled ref candidates step 2 saw, by dotted path. */
  refs: RefCandidates;
  decision: OpDecision;
  provenance: Provenance;
  /** Step 2 wall time, ms. */
  fillMs: number;
  /** Present when the args built a zod-valid action. */
  action?: Action;
  error?: string;
}

/** A gated turn: the user picks one of `options` or none of them. */
export interface PendingChoice {
  utterance: string;
  doc: ChatDocument;
  documents: ChatDocument[];
  decision: OpDecision;
  options: { entry: CatalogEntry; p: number }[];
}

export type ChatReply =
  | { kind: "answer"; text: string; decision: DecideResult | null }
  | { kind: "proposal"; proposal: ProposedAction }
  | { kind: "choose"; choice: PendingChoice };

/* ------------------------------ settings ------------------------------ */

export const SETTING_KEYS = {
  loraUrl: "bai.chat.loraUrl",
  kevUrl: "bai.chat.kevUrl",
  baseUrl: "bai.chat.modelBaseUrl",
  useKev: "bai.chat.useKev",
  trieMode: "bai.chat.trieMode",
  debug: "bai.chat.debug",
  /** Pre-C single-model URL: removed, never migrated to `loraUrl`. */
  legacyModelUrl: "bai.chat.modelUrl",
  /** A dropped custom pre-C URL, shown once in the tab. */
  legacyDropped: "bai.chat.legacyModelUrlDropped",
} as const;

export interface ChatSettings extends ModelSettings {
  /** The decision model toggle (default on). */
  useKev: boolean;
  trieMode: TrieMode;
}

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
function dropLegacyModelUrl(): void {
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
  return {
    loraUrl: read(SETTING_KEYS.loraUrl),
    kevUrl: read(SETTING_KEYS.kevUrl),
    baseUrl: read(SETTING_KEYS.baseUrl),
    useKev: read(SETTING_KEYS.useKev) !== "0",
    trieMode: read(SETTING_KEYS.trieMode) === "exact" ? "exact" : "branch",
  };
}

function saveChatSettings(s: ChatSettings): void {
  write(SETTING_KEYS.loraUrl, s.loraUrl?.trim() || null);
  write(SETTING_KEYS.kevUrl, s.kevUrl?.trim() || null);
  write(SETTING_KEYS.baseUrl, s.baseUrl?.trim() || null);
  write(SETTING_KEYS.useKev, s.useKev ? null : "0");
  write(SETTING_KEYS.trieMode, s.trieMode === "exact" ? "exact" : null);
}

function viteEnv(): Record<string, string | boolean | undefined> {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  return meta.env ?? {};
}

function envString(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Dev build, or the `bai.chat.debug=1` flag: parity check, timings. */
export function chatDebugEnabled(): boolean {
  return viteEnv().DEV === true || read(SETTING_KEYS.debug) === "1";
}

/** `navigator.deviceMemory` (GB, Chrome only), when exposed. */
export function deviceMemoryGb(): number | null {
  if (typeof navigator === "undefined") return null;
  const v: unknown = Reflect.get(navigator, "deviceMemory");
  return typeof v === "number" ? v : null;
}

/* ------------------------------- labels ------------------------------- */

export interface ConfigLabel {
  kind: "C" | "A" | "custom";
  text: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function kevReasonText(f: KevFallback): string {
  switch (f.reason) {
    case "off":
      return "turned off";
    case "skipped":
      return "skipped for this message";
    case "unavailable":
      return `unavailable: ${f.detail}`;
    case "failed":
      return `failed: ${f.detail}`;
  }
}

export function loraAloneText(reason: string): string {
  return `LoRA alone (decision model ${reason}): held-out-6 ${pct(C_HELDOUT6.loraAloneOp)} op, no ask step`;
}

function configLabel(
  sources: ResolvedSources,
  kevReason: string | null,
): ConfigLabel {
  if (sources.config === "custom")
    return {
      kind: "custom",
      text: "Custom models, not measured with this pipeline; expect more wrong proposals",
    };
  if (kevReason) return { kind: "A", text: loraAloneText(kevReason) };
  return {
    kind: "C",
    text: `Configuration C: X5 × Kev-FT, gate τ ${C_FUSION.tau} (held-out-6: ${pct(C_HELDOUT6.opOneShot)} op one-shot, ${pct(C_HELDOUT6.asked)} asked)`,
  };
}

/* ------------------------------- timings ------------------------------ */

export interface ChatTurnTiming {
  at: number;
  kind: "none" | "op" | "fill" | "load";
  /** kind "load": which model, its load time and GPU offload. */
  role?: "lora" | "kev";
  loadMs?: number;
  downloadBytes?: number;
  gpuLayers?: { offloaded: number; total: number } | null;
  config?: "C" | "A";
  decide?: OpDecision["timings"];
  trie?: OpDecision["trie"];
  fillMs?: number;
  /** kind "none": whether Kev was called (no: none skips it). */
  kevCalled?: boolean;
}

declare global {
  interface Window {
    __baiChatTimings?: ChatTurnTiming[];
  }
}

function recordTiming(t: ChatTurnTiming): void {
  if (typeof window === "undefined" || !chatDebugEnabled()) return;
  (window.__baiChatTimings ??= []).push(t);
}

/* -------------------------------- hook -------------------------------- */

export function useChatLlm() {
  const [settings, setSettingsState] = useState<ChatSettings>(readChatSettings);
  // after readChatSettings, which records the dropped URL
  const [legacyUrl, setLegacyUrl] = useState<string | null>(legacyModelNotice);
  const dismissLegacyNotice = useCallback(() => {
    dismissLegacyModelNotice();
    setLegacyUrl(null);
  }, []);
  const models = useSyncExternalStore(subscribeChatModels, chatModelsState);
  const sources = useMemo(() => {
    const env = viteEnv();
    return resolveCSources(settings, {
      loraUrl: envString(env.VITE_CHAT_LORA_URL),
      kevUrl: envString(env.VITE_CHAT_KEV_URL),
      modelUrl: envString(env.VITE_CHAT_MODEL_URL),
      baseUrl: envString(env.VITE_CHAT_MODEL_BASE_URL),
    });
  }, [settings]);
  const skipRef = useRef<(() => void) | null>(null);
  const loraInfo = models.lora.info;
  const kevInfo = models.kev.info;
  useEffect(() => {
    if (loraInfo)
      recordTiming({ at: Date.now(), kind: "load", role: "lora", loadMs: loraInfo.loadMs, downloadBytes: loraInfo.downloadBytes, gpuLayers: loraInfo.gpuLayers });
  }, [loraInfo]);
  useEffect(() => {
    if (kevInfo)
      recordTiming({ at: Date.now(), kind: "load", role: "kev", loadMs: kevInfo.loadMs, downloadBytes: kevInfo.downloadBytes, gpuLayers: kevInfo.gpuLayers });
  }, [kevInfo]);

  const blocker =
    kevBlocker(settings.useKev) ??
    loraTrieBlocker(models.lora.info) ??
    (models.kev.phase === "error" ? `failed to load: ${models.kev.error ?? ""}` : null);
  const label = configLabel(sources, blocker);

  const setSettings = useCallback((patch: Partial<ChatSettings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      saveChatSettings(next);
      if (patch.useKev === false) void unloadKev(true);
      if (patch.useKev === true || patch.kevUrl !== undefined || patch.baseUrl !== undefined)
        resetKevError();
      return next;
    });
  }, []);

  /** Plain answer for a request that changes nothing (Q&A stub). */
  const answer = useCallback(async (client: LlmClient, question: string) => {
    // TODO(spike): ground answers in `useGraphSearch` results (Scope A).
    setChatStage("answer");
    const r = await client.chatStream(
      [
        {
          role: "system",
          content: "You are a concise assistant inside a personal knowledge vault.",
        },
        { role: "user", content: question },
      ],
      { maxTokens: 256, temperature: 0.3 },
    );
    return r.text;
  }, []);

  /** A question with no target document: answered, nothing dispatched. */
  const ask = useCallback(
    async (utterance: string): Promise<ChatReply> => {
      try {
        const { client } = await ensureLora(sources.lora);
        return { kind: "answer", text: await answer(client, utterance), decision: null };
      } finally {
        setChatStage(null);
      }
    },
    [answer, sources],
  );

  /** Step 2 on the chosen op, then the dispatchable action. */
  const fill = useCallback(
    async (
      utterance: string,
      entry: CatalogEntry,
      doc: ChatDocument,
      documents: ChatDocument[],
      decision: OpDecision,
      provenance: Provenance,
    ): Promise<ProposedAction> => {
      const { client, cache } = await ensureLora(sources.lora);
      setChatStage("fill");
      const refs = refCandidatesFor(entry.key, doc.state, driveRefContext(doc, documents));
      const t0 = performance.now();
      const step2 = await fillArgs(utterance, entry, client, {
        refCandidates: refs,
        today: localDate(new Date()),
        currentLists: currentListsFor(entry.key, doc.state),
        cache,
      });
      const fillMs = performance.now() - t0;
      recordTiming({ at: Date.now(), kind: "fill", fillMs });
      const base = { utterance, entry, step2, doc, refs, decision, provenance, fillMs };
      if (!step2.args) return { ...base, error: step2.error ?? "no arguments" };
      const built = buildAction(entry, step2.args, {
        generateId,
        now: () => new Date().toISOString(),
        // TODO(spike): use the signed-in user's identity.
        actor: "chat",
      });
      return built.ok ? { ...base, action: built.action } : { ...base, error: built.error };
    },
    [sources],
  );

  /**
   * Configuration C on `doc`: no-action is answered; a confident op becomes
   * a proposal; a small fused margin asks the user to choose among 3.
   */
  const send = useCallback(
    async (
      utterance: string,
      doc: ChatDocument,
      documents: ChatDocument[],
    ): Promise<ChatReply> => {
      try {
        const { client } = await ensureLora(sources.lora);
        const block =
          kevBlocker(settings.useKev) ?? loraTrieBlocker(chatModelsState().lora.info);
        if (block === "off") markKevOff();
        const skip = new Promise<void>((resolve) => (skipRef.current = resolve));
        const decision = await decideOp(
          utterance,
          doc.docType,
          {
            catalog: v1Catalog(),
            lora: client,
            kev: block ? null : kevBackendFor(sources.kev),
            kevOff: block
              ? block === "off"
                ? { reason: "off" }
                : { reason: "unavailable", detail: block }
              : undefined,
          },
          {
            trieMode: settings.trieMode,
            skipKev: skip,
            servedT: kevServedT(),
            onStage: setChatStage,
          },
        );
        skipRef.current = null;
        recordTiming({
          at: Date.now(),
          kind: decision.kind,
          config: decision.kind === "op" ? decision.config : undefined,
          decide: decision.timings,
          trie: decision.kind === "op" ? decision.trie : undefined,
          kevCalled: decision.kind === "none" ? decision.kevCalled : undefined,
        });
        if (decision.kind === "none")
          return { kind: "answer", text: await answer(client, utterance), decision };
        if (decision.asked)
          return {
            kind: "choose",
            choice: {
              utterance,
              doc,
              documents,
              decision,
              options: decision.offered.map((entry) => ({
                entry,
                p: decision.p?.[entry.key] ?? 0,
              })),
            },
          };
        const provenance: Provenance =
          decision.config === "C"
            ? { kind: "fused", p: decision.p?.[decision.pick.key] ?? 0 }
            : {
                kind: "lora-alone",
                reason: kevReasonText(decision.fallback ?? { reason: "off" }),
              };
        return {
          kind: "proposal",
          proposal: await fill(utterance, decision.pick, doc, documents, decision, provenance),
        };
      } finally {
        skipRef.current = null;
        setChatStage(null);
      }
    },
    [answer, fill, settings, sources],
  );

  /** The user picked `entry` from a gated choice. */
  const choose = useCallback(
    async (choice: PendingChoice, entry: CatalogEntry): Promise<ChatReply> => {
      try {
        return {
          kind: "proposal",
          proposal: await fill(
            choice.utterance,
            entry,
            choice.doc,
            choice.documents,
            choice.decision,
            { kind: "chosen", from: choice.options.length },
          ),
        };
      } finally {
        setChatStage(null);
      }
    },
    [fill],
  );

  /** While waiting for Kev: run this message with the LoRA alone. */
  const skipKev = useCallback(() => skipRef.current?.(), []);

  /** Dev: `window.__baiChatParityC()` on the configured models. */
  const installParity = useCallback(async () => {
    const { installParityC } = await import("../chat/dev/parity-c.js");
    installParityC(async () => ({
      lora: (await ensureLora(sources.lora)).client,
      kev: await ensureKev(sources.kev),
    }));
  }, [sources]);
  useEffect(() => {
    if (chatDebugEnabled()) void installParity();
  }, [installParity]);

  const runParity = useCallback(async () => {
    await installParity();
    if (!window.__baiChatParityC) throw new Error("parity check not installed");
    return window.__baiChatParityC(settings.trieMode);
  }, [installParity, settings]);

  return {
    settings,
    setSettings,
    /** File name of a dropped custom pre-C model URL (one-time notice). */
    legacyModelFile: legacyUrl ? fileNameOf(legacyUrl) : null,
    dismissLegacyNotice,
    sources,
    lora: models.lora,
    kev: models.kev,
    stage: models.stage,
    config: label,
    kevBlocker: blocker,
    deviceMemoryGb: deviceMemoryGb(),
    debug: chatDebugEnabled(),
    send,
    choose,
    ask,
    skipKev,
    unloadKev: () => unloadKev(!settings.useKev),
    clearCache: clearModelCache,
    runParity,
  };
}

export type ChatLlm = ReturnType<typeof useChatLlm>;
