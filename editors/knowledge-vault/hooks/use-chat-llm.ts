import { useCallback, useMemo, useState } from "react";
import { generateId } from "document-model/core";
import type { Action } from "document-model";
import { loadLlm, type LlmClient, type LlmInfo } from "../chat/core/index.js";
import {
  resolveModelSource,
  type ResolvedModel,
} from "../chat/core/model-source.js";
import type { ScoreCache } from "../chat/core/op-scorer.js";
import {
  driveRefContext,
  refCandidatesFor,
  type ChatDocument,
} from "../chat/core/ref-candidates.js";
import {
  runV1,
  v1Action,
  v1Catalog,
  type RefCandidates,
  type V1Result,
} from "../chat/core/v1-pipeline.js";

export type ChatLlmStatus = "idle" | "loading" | "ready" | "error";

export interface ProposedAction {
  result: Extract<V1Result, { kind: "action" }>;
  /** The document the action targets. */
  doc: ChatDocument;
  /** The labeled ref candidates step 2 saw, by dotted path. */
  refs: RefCandidates;
  /** Present when the args built a zod-valid action. */
  action?: Action;
  error?: string;
}

export type ChatReply =
  | { kind: "answer"; text: string; result: V1Result | null }
  | { kind: "proposal"; proposal: ProposedAction };

export interface ChatLoadInfo {
  llm: LlmInfo;
  /** Wall time of this `ensureLoaded` call, ms. */
  wallMs: number;
}

/** localStorage key of the tab's model URL setting. */
export const MODEL_URL_KEY = "bai.chat.modelUrl";

function readSetting(): string | null {
  try {
    return globalThis.localStorage.getItem(MODEL_URL_KEY);
  } catch {
    return null;
  }
}

export function saveModelUrlSetting(url: string): void {
  try {
    if (url.trim()) globalThis.localStorage.setItem(MODEL_URL_KEY, url.trim());
    else globalThis.localStorage.removeItem(MODEL_URL_KEY);
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

/** `VITE_CHAT_MODEL_URL`, when the host's Vite exposes it to this package. */
function envModelUrl(): string | undefined {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  };
  return meta.env?.VITE_CHAT_MODEL_URL;
}

// One model per page: switching tabs must not reload 229 MB. Content-free
// ref-scoring requests depend on the model, so the cache goes with it.
let loaded: {
  key: string;
  client: Promise<LlmClient>;
  cache: ScoreCache;
} | null = null;

function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function useChatLlm() {
  const [setting, setSetting] = useState<string | null>(readSetting);
  const model: ResolvedModel = useMemo(
    () => resolveModelSource(setting, envModelUrl()),
    [setting],
  );
  const [status, setStatus] = useState<ChatLlmStatus>(
    loaded?.key === model.key ? "ready" : "idle",
  );
  const [progress, setProgress] = useState(0);
  const [load, setLoad] = useState<ChatLoadInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setModelUrl = useCallback((url: string) => {
    saveModelUrlSetting(url);
    setSetting(url.trim() || null);
    setStatus("idle");
    setLoad(null);
  }, []);

  /** wllama + the chosen GGUF (the R2c default needs no embedder). */
  const ensureLoaded = useCallback(async () => {
    const t0 = performance.now();
    if (loaded?.key !== model.key) {
      const old = loaded;
      setStatus("loading");
      setError(null);
      const src = model.source;
      loaded = {
        key: model.key,
        cache: new Map(),
        client: (async () => {
          if (old) await (await old.client.catch(() => null))?.exit();
          return loadLlm({
            backend: hasWebGpu() ? "webgpu" : "cpu",
            onProgress: (l, t) => setProgress(t ? l / t : 0),
            ...(src.kind === "url"
              ? { modelUrl: src.url }
              : { model: { repo: src.repo, file: src.file } }),
          });
        })(),
      };
    }
    const mine = loaded;
    try {
      const client = await mine.client;
      setLoad({ llm: client.info, wallMs: performance.now() - t0 });
      setStatus("ready");
      return { client, cache: mine.cache };
    } catch (err) {
      if (loaded === mine) loaded = null;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      throw err;
    }
  }, [model]);

  /** Plain answer for a request that changes nothing (Q&A stub). */
  const answer = useCallback(async (client: LlmClient, question: string) => {
    // TODO(spike): ground answers in `useGraphSearch` results (Scope A).
    const r = await client.chatStream(
      [
        {
          role: "system",
          content:
            "You are a concise assistant inside a personal knowledge vault.",
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
      const { client } = await ensureLoaded();
      return { kind: "answer", text: await answer(client, utterance), result: null };
    },
    [answer, ensureLoaded],
  );

  /**
   * The v1 pipeline (R2c) on `doc`: the model's no-action is answered,
   * anything else becomes one proposed action (confirm before dispatch).
   */
  const send = useCallback(
    async (
      utterance: string,
      doc: ChatDocument,
      documents: ChatDocument[],
    ): Promise<ChatReply> => {
      const { client, cache } = await ensureLoaded();
      const ctx = driveRefContext(doc, documents);
      let refs: RefCandidates = {};
      const result = await runV1(
        utterance,
        doc.docType,
        (entry) => (refs = refCandidatesFor(entry.key, doc.state, ctx)),
        {
          runtime: { catalog: v1Catalog() },
          completeJson: client.completeJson,
          scoreText: client.scoreText,
          cache,
        },
      );
      if (result.kind === "no-action")
        return {
          kind: "answer",
          text: await answer(client, utterance),
          result,
        };
      const built = v1Action(result, {
        generateId,
        now: () => new Date().toISOString(),
        // TODO(spike): use the signed-in user's identity.
        actor: "chat",
      });
      return {
        kind: "proposal",
        proposal: built.ok
          ? { result, doc, refs, action: built.action }
          : { result, doc, refs, error: built.error },
      };
    },
    [answer, ensureLoaded],
  );

  return {
    status,
    progress,
    load,
    error,
    model,
    setModelUrl,
    ensureLoaded,
    send,
    ask,
  };
}
